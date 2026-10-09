/**
 * Times one Bun-built bundle of the flow benchmark on Bun and Node, so neither runtime's TypeScript loader is
 * priced, and rewrites the runtime blocks of README.md. Flags: README, "Run it".
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RUNTIME_NAMES, type RuntimeName } from '../src/runtime';
import type { Run } from './model';
import { arg, BUILD_DIR, bundleForNode, spawnJson } from './project';
import { syncRuntimeReport } from './runtime-report';

function found(command: string): boolean {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

function runOn(runtime: RuntimeName, bundlePath: string, iterations: number): Run {
  const out = resolve(BUILD_DIR, `${runtime}.json`);
  // `--portable`: Bun would otherwise measure three entries Node cannot, carrying more work per round
  // than it does, and its tail would answer for that instead of for Bun.
  const flags = ['--portable', '--iterations', String(iterations), '--json', out];
  return spawnJson<Run>(runtime, runtime, [bundlePath, ...flags], out);
}

async function main() {
  // Far more rounds than the median tables need: a p99 drawn from 250 rounds is the third slowest of them,
  // which moves by milliseconds between runs. 2000 puts twenty rounds behind the figure instead of two.
  const iterations = Number(arg('iterations') ?? 2000);
  const bundlePath = await bundleForNode('scripts/flow-bench.ts');

  const missing = RUNTIME_NAMES.filter((runtime) => !found(runtime));
  if (missing.length > 0) {
    throw new Error(`a runtime comparison needs ${missing.join(' and ')} installed`);
  }

  const runs = RUNTIME_NAMES.map((runtime) => {
    console.log(`\n=== ${runtime} ===`);
    return runOn(runtime, bundlePath, iterations);
  });

  syncRuntimeReport(runs);
  console.log(`\nREADME.md runtime blocks updated from ${runs.map((r) => r.runtime.label).join(', ')}`);
}

await main();
