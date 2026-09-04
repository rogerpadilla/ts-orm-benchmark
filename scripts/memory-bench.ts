/**
 * Measures how much heap each entry allocates per lifecycle, step by step, and rewrites the memory blocks
 * of README.md. Same seven steps `scripts/flows.ts` defines; only the instrument changes, from a clock to
 * `heapUsed`. Why Node alone, and why {@link PORTABLE_ENTRIES}, is the Memory section of README.md.
 * No timings here: allocation settles inside 60 rounds, latency does not, and `flow-bench.ts` owns it.
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/postgres bun scripts/memory-bench.ts
 *   bun scripts/memory-bench.ts --iterations 120
 *   bun scripts/memory-bench.ts --iterations 3 --verify   # assert every step, write nothing
 *   bun scripts/memory-bench.ts --json /tmp/mem.json  # write the run, leave README alone
 */

import { resolve } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import type pg from 'pg';
import { RUNTIME } from '../src/runtime';
import { connect, resetFixture } from './fixture';
import { checkStep, FLOWS, type Flow } from './flows';
import { printMemorySummary, syncMemoryReport } from './memory-report';
import { byStep, type Entry, type MemoryRun, median, PORTABLE_ENTRIES, STEPS, sortedAsc } from './model';
import { arg, BUILD_DIR, bundleForNode, publish, spawnJson, writeJson } from './project';

/**
 * One entry's whole lifecycle, N times, weighing the heap either side of every step. Comes back one entry
 * wide for {@link merge} to stitch together. No forced collection in here, for the reason the README's
 * method gives: left alone the heap only grows, so the difference either side of a step is what it
 * allocated. Measured with `global.gc()` instead, UQL read 19% higher over ten rounds than over forty.
 */
async function measure(entry: Entry, iterations: number): Promise<MemoryRun> {
  // Long enough that the hot path has tiered up: allocation per lifecycle keeps falling until it has.
  const warmup = Math.min(60, iterations);
  console.log(`  ${entry}: ${iterations} rounds after ${warmup} warmup`);

  // Delivered on a later task than the collection itself, so a late arrival lands in the next step's
  // window and discards that sample too.
  let collections = 0;
  new PerformanceObserver(() => {
    collections++;
  }).observe({ entryTypes: ['gc'] });

  const { admin, clients, postgres, close } = await connect();
  const flow = FLOWS[entry](clients);

  const samples = byStep((): number[] => []);
  let taken = 0;
  let retained = 0;

  try {
    for (let round = 0; round < warmup + iterations; round++) {
      // Reset outside every measured window: it is the harness's own allocation, ~310KB a round, and
      // billing it to the entry would dilute every figure the table is read for.
      await resetFixture(admin);
      for (const step of STEPS) {
        const op = flow[step];
        const before = collections;
        const heapBefore = process.memoryUsage().heapUsed;
        const returned = await op.run();
        const allocated = process.memoryUsage().heapUsed - heapBefore;
        checkStep(entry, step, op, returned);
        if (round < warmup) {
          continue;
        }
        taken++;
        if (collections === before && allocated > 0) {
          samples[step].push(allocated);
        }
      }
    }
    const empty = STEPS.filter((step) => samples[step].length === 0);
    if (empty.length) {
      throw new Error(
        `${entry} kept no clean sample of ${empty.join(', ')}: it allocates enough that a collection ` +
          'lands in every window. Raise --iterations.',
      );
    }
    retained = await measureRetention(admin, flow, iterations);
  } finally {
    await close();
  }

  const kept = STEPS.reduce((sum, step) => sum + samples[step].length, 0);
  return {
    runtime: RUNTIME,
    postgres,
    iterations,
    warmup,
    entries: [entry],
    results: byStep((step) => [Math.round(median(sortedAsc(samples[step])) / 1024)]),
    discarded: [1 - kept / taken],
    retained: [Math.round(retained / 1024)],
  };
}

/**
 * Whether anything survives the lifecycles: the same rounds again, bracketed by collections, weighed
 * after. Last and on its own, since the re-tiering a forced collection causes would otherwise bias every
 * per-step figure above.
 */
async function measureRetention(admin: pg.Pool, flow: Flow, iterations: number): Promise<number> {
  forceGc();
  const before = process.memoryUsage().heapUsed;
  for (let round = 0; round < iterations; round++) {
    await resetFixture(admin);
    for (const step of STEPS) {
      await flow[step].run();
    }
  }
  forceGc();
  return process.memoryUsage().heapUsed - before;
}

/**
 * Node exposes this only under `--expose-gc`. Called as `globalThis.gc?.()` it would no-op there, and the
 * retention phase would report uncollected garbage as retention.
 */
function forceGc(): void {
  const gc = globalThis.gc;
  if (typeof gc !== 'function') {
    throw new Error('this needs Node --expose-gc, which `measureOn` passes: run it through `bun run bench.memory`');
  }
  gc();
}

/**
 * One child per entry. Run together in one process the entries share a heap, and whichever ran first paid
 * for warming the code the rest then reused, which put the ranking in declaration order.
 */
function measureOn(bundlePath: string, entry: Entry, iterations: number): MemoryRun {
  const out = resolve(BUILD_DIR, 'memory-entry.json');
  const flags = ['--entry', entry, '--iterations', String(iterations), '--json', out];
  const run = spawnJson<MemoryRun>(`measuring ${entry}`, 'node', ['--expose-gc', bundlePath, ...flags], out);
  // Every child writes the same path, so check we read back what was asked for rather than whatever is there.
  if (run.entries[0] !== entry) {
    throw new TypeError(`asked ${entry} for its numbers and read ${run.entries[0]}'s`);
  }
  return run;
}

/** The runs come back one entry wide; everything but the entry itself is the same in all of them. */
function merge(runs: MemoryRun[]): MemoryRun {
  return {
    ...runs[0],
    entries: runs.flatMap((run) => run.entries),
    results: byStep((step) => runs.flatMap((run) => run.results[step])),
    discarded: runs.flatMap((run) => run.discarded),
    retained: runs.flatMap((run) => run.retained),
  };
}

async function main(): Promise<void> {
  const iterations = Number(arg('iterations') ?? 60);
  const entry = arg('entry') as Entry | undefined;

  // The child half: one entry, one process, its numbers written where the parent asked for them.
  if (entry) {
    writeJson(arg('json') as string, await measure(entry, iterations));
    return;
  }

  if (RUNTIME.name !== 'bun') {
    throw new Error('run this with Bun; it builds the bundle each Node child measures');
  }

  console.log(`memory benchmark: ${iterations} rounds/entry, one Node process each\n`);
  const bundlePath = await bundleForNode('scripts/memory-bench.ts');
  const run = merge(PORTABLE_ENTRIES.map((each) => measureOn(bundlePath, each, iterations)));

  console.log();
  printMemorySummary(run);
  publish(run, syncMemoryReport, 'README.md memory blocks updated');
}

await main();
