/**
 * Times each entry's lifecycle against the hand-written `raw pg` and `bun sql` floors, then rewrites every
 * generated block in README.md. That file is where the method and its limits are stated; the steps
 * themselves are `scripts/flows.ts`.
 *
 * Runs on Bun, Node and Deno; off Bun the Bun SQL entries are absent, since that client is a Bun API.
 * `scripts/runtime-bench.ts` is what times one bundle of this file on all three.
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/postgres bun scripts/flow-bench.ts
 *   bun scripts/flow-bench.ts --iterations 400
 *   bun scripts/flow-bench.ts --iterations 3 --verify   # assert every step, write nothing
 *   bun scripts/flow-bench.ts --json /tmp/bun.json      # write the run, leave README alone
 *   bun scripts/flow-bench.ts --portable                # only the entries every runtime can load
 */

import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { createClients } from '../src/clients';
import { RUNTIME } from '../src/runtime';
import { ensureDatabase, postgresVersion, resetFixture } from './fixture';
import { checkStep, FLOWS } from './flows';
import {
  ENTRIES,
  median,
  PORTABLE_ENTRIES,
  type Results,
  type Run,
  STEPS,
  type Step,
  sortedAsc,
  sortedRoundTotals,
  spreadOf,
  tailFrom,
} from './model';
import { arg, flag } from './project';
import { printSummary, syncResults } from './report';

/** Five progress lines whatever the run length, and one when the warmup ends. */
function logProgress(round: number, warmup: number, iterations: number): void {
  const measured = round - warmup + 1;
  const every = Math.max(1, Math.round(iterations / 5));
  if (round === warmup - 1) {
    console.log(`warmup done (${warmup} rounds), measuring ${iterations}`);
  } else if (measured > 0 && measured % every === 0) {
    console.log(`  ${measured}/${iterations}`);
  }
}

async function main() {
  const baseUrl = process.env.DATABASE_URL ?? 'postgres://localhost:5432/postgres';
  const iterations = Number(arg('iterations') ?? 250);
  // CI runs a handful of iterations purely to exercise every step's assertions, where the timings are
  // meaningless and must not reach the published artifacts.
  const verifyOnly = flag('verify');
  const jsonPath = arg('json');
  // Half the run again as warmup: below that, per-entry figures swing by hundreds of µs between runs.
  // Capped, because reaching steady state is what warmup is for and a long tail run does not need longer.
  const warmup = Math.min(250, Math.max(40, Math.round(iterations / 2)));
  // Off Bun the Bun SQL entries cannot load at all. `--portable` drops them on Bun too, so a cross-runtime
  // run measures the same entries everywhere instead of making Bun carry three more through every round.
  const entries = RUNTIME.name === 'bun' && !flag('portable') ? [...ENTRIES] : PORTABLE_ENTRIES;

  console.log(`flow benchmark on ${RUNTIME.label}: ${iterations} iterations/step, ${warmup} warmup`);
  const benchUrl = await ensureDatabase(baseUrl);
  const admin = new pg.Pool({ connectionString: benchUrl, max: 1 });
  const postgres = await postgresVersion(admin);
  console.log(postgres, '\n');

  const clients = await createClients(benchUrl);
  // Built once. Some flows hoist a constant statement out of the timed section, which only holds if the
  // flow itself is not rebuilt per iteration.
  const flows = entries.map((entry) => FLOWS[entry](clients));
  const samples = entries.map(
    () => Object.fromEntries(STEPS.map((s) => [s, [] as number[]])) as Record<Step, number[]>,
  );

  try {
    for (let round = 0; round < warmup + iterations; round++) {
      // One pass per entry per round, rotated so each spends an equal share of its samples in every
      // position. Running each entry to completion made the result depend on declaration order.
      for (let k = 0; k < flows.length; k++) {
        const i = (k + round) % flows.length;

        // One ordered pass, reset once before it. The steps are a lifecycle, not independent cases:
        // `readAgain` only means anything after `update` ran, and `readEmpty` only after `delete`.
        // Resetting per step would erase the very state each read is there to verify.
        await resetFixture(admin);
        for (const step of STEPS) {
          const op = flows[i][step];
          const t0 = process.hrtime.bigint();
          const returned = await op.run();
          const elapsed = Number(process.hrtime.bigint() - t0) / 1000;
          if (round === 0) {
            checkStep(entries[i], step, op, returned);
          }
          if (round >= warmup) {
            samples[i][step].push(elapsed);
          }
        }
      }
      logProgress(round, warmup, iterations);
    }
  } finally {
    await clients.destroyAll();
    await admin.end();
  }

  const totals = samples.map(sortedRoundTotals);
  const run: Run = {
    runtime: RUNTIME,
    postgres,
    iterations,
    warmup,
    entries,
    results: Object.fromEntries(
      STEPS.map((step) => [step, samples.map((sample) => Math.round(median(sortedAsc(sample[step]))))]),
    ) as Results,
    tails: totals.map(tailFrom),
    spreads: totals.map(spreadOf),
  };

  console.log();
  printSummary(run);

  if (verifyOnly) {
    console.log('\n--verify: every step asserted, nothing written');
    return;
  }

  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
    console.log(`\n${jsonPath} written`);
    return;
  }

  syncResults(run);
  console.log('\nresults.js + README.md updated');
}

await main();
