/**
 * Measures how much heap each entry allocates per lifecycle, step by step, and rewrites the memory blocks
 * of README.md. The steps are the same seven `scripts/flows.ts` defines and the timing benchmark runs;
 * only the instrument changes, from a clock to `heapUsed`.
 *
 * Runs on Node, alone among the benchmarks here, because it is the only runtime whose heap counter moves
 * on allocation: Bun's `heapStats().heapSize` and `process.memoryUsage().heapUsed` both refresh only at a
 * collection, so on Bun a hundred thousand fresh objects read as zero bytes. That costs the three Bun SQL
 * entries, which is why this measures {@link PORTABLE_ENTRIES}, the set the runtime comparison uses.
 *
 * Timings are deliberately not taken here. Allocation is deterministic and settles inside 60 rounds;
 * latency is not, and off these same rounds it swung 30% between runs. `scripts/flow-bench.ts` owns that.
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/postgres bun scripts/memory-bench.ts
 *   bun scripts/memory-bench.ts --iterations 120
 *   bun scripts/memory-bench.ts --iterations 3 --verify   # assert every step, write nothing
 *   bun scripts/memory-bench.ts --json /tmp/mem.json  # write the run, leave README alone
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import pg from 'pg';
import { createClients } from '../src/clients';
import { RUNTIME } from '../src/runtime';
import { ensureDatabase, postgresVersion, resetFixture } from './fixture';
import { checkStep, FLOWS, type Flow } from './flows';
import { printMemorySummary, syncMemoryReport } from './memory-report';
import {
  type Entry,
  type MemoryRun,
  median,
  PORTABLE_ENTRIES,
  type Results,
  STEPS,
  type Step,
  sortedAsc,
} from './model';
import { arg, BUILD_DIR, bundleForNode, flag } from './project';

/**
 * One entry's whole lifecycle, N times, weighing the heap either side of every step. Comes back as a run
 * one entry wide, which {@link merge} stitches together, so the child returns the type the parent needs.
 *
 * No forced collection anywhere in here. `global.gc()` frees compiled code along with the garbage and the
 * rounds after it pay to re-tier: measured that way UQL read 19% higher over ten rounds than over forty,
 * purely because the early rounds were still recovering. Left alone the heap only grows between
 * collections, so the difference either side of a step is what that step allocated.
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

  const benchUrl = await ensureDatabase(process.env.DATABASE_URL ?? 'postgres://localhost:5432/postgres');
  const admin = new pg.Pool({ connectionString: benchUrl, max: 1 });
  const postgres = await postgresVersion(admin);
  const clients = await createClients(benchUrl);
  const flow = FLOWS[entry](clients);

  const samples = Object.fromEntries(STEPS.map((s) => [s, [] as number[]])) as Record<Step, number[]>;
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
    await clients.destroyAll();
    await admin.end();
  }

  const kept = STEPS.reduce((sum, step) => sum + samples[step].length, 0);
  return {
    runtime: RUNTIME,
    postgres,
    iterations,
    warmup,
    entries: [entry],
    results: Object.fromEntries(
      STEPS.map((step) => [step, [Math.round(median(sortedAsc(samples[step])) / 1024)]]),
    ) as Results,
    discarded: [1 - kept / taken],
    retained: [Math.round(retained / 1024)],
  };
}

/**
 * Whether anything survives the lifecycles: the same rounds again, bracketed by collections, weighed
 * after. Its own phase and always last, because a forced collection frees compiled code along with the
 * garbage and the rounds after it allocate more while they re-tier - the bias that would land on the
 * per-step figures if this shared their loop.
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
  const result = spawnSync('node', ['--expose-gc', bundlePath, ...flags], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    throw new Error(`measuring ${entry} exited with ${result.status ?? result.signal}`);
  }
  // Every child writes the same path, so read back what was asked for rather than whatever is there.
  const run = JSON.parse(readFileSync(out, 'utf8')) as MemoryRun;
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
    results: Object.fromEntries(STEPS.map((step) => [step, runs.flatMap((run) => run.results[step])])) as Results,
    discarded: runs.flatMap((run) => run.discarded),
    retained: runs.flatMap((run) => run.retained),
  };
}

async function main(): Promise<void> {
  const iterations = Number(arg('iterations') ?? 60);
  const entry = arg('entry') as Entry | undefined;

  // The child half: one entry, one process, its numbers written where the parent asked for them.
  if (entry) {
    writeFileSync(arg('json') as string, `${JSON.stringify(await measure(entry, iterations), null, 2)}\n`);
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

  if (flag('verify')) {
    console.log('\n--verify: every step asserted, nothing written');
    return;
  }

  const jsonPath = arg('json');
  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
    console.log(`\n${jsonPath} written`);
    return;
  }

  syncMemoryReport(run);
  console.log('\nREADME.md memory blocks updated');
}

await main();
