/**
 * Times each entry's lifecycle against the hand-written `raw pg` and `bun sql` floors, then rewrites every
 * generated block in README.md, where the method and its limits are stated. The steps are in
 * `scripts/flows.ts`. Runs on Bun, Node and Deno; off Bun the Bun SQL entries are absent, since that
 * client is a Bun API, and `scripts/runtime-bench.ts` times one bundle of this file on all three.
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/postgres bun scripts/flow-bench.ts
 *   bun scripts/flow-bench.ts --iterations 400
 *   bun scripts/flow-bench.ts --iterations 3 --verify   # assert every step, write nothing
 *   bun scripts/flow-bench.ts --json /tmp/bun.json      # write the run, leave README alone
 *   bun scripts/flow-bench.ts --portable                # only the entries every runtime can load
 */

import { RUNTIME } from '../src/runtime';
import { connect, resetFixture } from './fixture';
import { checkStep, FLOWS } from './flows';
import {
  byStep,
  ENTRIES,
  median,
  PORTABLE_ENTRIES,
  type Run,
  STEPS,
  sortedAsc,
  sortedRoundTotals,
  spreadOf,
  tailFrom,
} from './model';
import { arg, flag, publish } from './project';
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
  const iterations = Number(arg('iterations') ?? 250);
  // Half the run again as warmup: below that, per-entry figures swing by hundreds of µs between runs.
  // Capped, because reaching steady state is what warmup is for and a long tail run does not need longer.
  const warmup = Math.min(250, Math.max(40, Math.round(iterations / 2)));
  // Off Bun the Bun SQL entries cannot load at all. `--portable` drops them on Bun too, so a cross-runtime
  // run measures the same entries everywhere instead of making Bun carry three more through every round.
  const entries = RUNTIME.name === 'bun' && !flag('portable') ? [...ENTRIES] : PORTABLE_ENTRIES;

  console.log(`flow benchmark on ${RUNTIME.label}: ${iterations} iterations/step, ${warmup} warmup`);
  const { admin, clients, postgres, close } = await connect();
  console.log(postgres, '\n');

  // Built once. Some flows hoist a constant statement out of the timed section, which only holds if the
  // flow itself is not rebuilt per iteration.
  const flows = entries.map((entry) => FLOWS[entry](clients));
  const samples = entries.map(() => byStep((): number[] => []));

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
          checkStep(entries[i], step, op, returned);
          if (round >= warmup) {
            samples[i][step].push(elapsed);
          }
        }
      }
      logProgress(round, warmup, iterations);
    }
  } finally {
    await close();
  }

  const totals = samples.map(sortedRoundTotals);
  const run: Run = {
    runtime: RUNTIME,
    postgres,
    iterations,
    warmup,
    entries,
    results: byStep((step) => samples.map((sample) => Math.round(median(sortedAsc(sample[step]))))),
    tails: totals.map(tailFrom),
    spreads: totals.map(spreadOf),
  };

  console.log();
  printSummary(run);
  publish(run, syncResults, 'results.js + README.md updated');
}

await main();
