/**
 * Times the same flow benchmark on Bun, Node and Deno, one runtime at a time, then rewrites the runtime
 * blocks of README.md.
 *
 * All three run one bundle built by Bun, not the TypeScript sources: the runtimes disagree on how they
 * load TypeScript, and letting each transpile for itself would price the transpiler as the runtime. Off
 * Bun the three Bun SQL entries are absent, since that client is a Bun API.
 *
 * Usage:
 *   DATABASE_URL=postgres://localhost:5432/postgres bun scripts/runtime-bench.ts
 *   bun scripts/runtime-bench.ts --iterations 200   # medians hold, the p99 column does not
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { RuntimeName } from '../src/runtime';
import type { Run } from './model';
import { arg, BUILD_DIR, bundleForNode, installedVersion, readJson, root, spawnJson, writeJson } from './project';
import { syncRuntimeReport } from './runtime-report';

type Runner = { command: string; args: (bundle: string) => string[] };

/** Bun first: it is the only runtime that can run every entry, so its ranking orders the table. */
const RUNTIMES: Record<RuntimeName, Runner> = {
  bun: { command: 'bun', args: (bundle) => [bundle] },
  node: { command: 'node', args: (bundle) => [bundle] },
  deno: {
    command: 'deno',
    // `--node-modules-dir=none`: Deno's own layout relinks the installed `node_modules` underneath itself,
    // which leaves Bun, Node and every editor resolving a different tree. It reads the import map instead.
    //
    // `--min-dep-age=0`: Deno refuses an npm version published in the last 24 hours. That is a sensible
    // default and the wrong one here - the import map pins the versions Bun and Node just measured, so
    // the alternative is not an older release but no Deno column at all on the day an ORM ships.
    args: (bundle) => [
      'run',
      '--allow-all',
      '--node-modules-dir=none',
      '--no-lock',
      '--min-dep-age=0',
      denoImportMap(),
      bundle,
    ],
  },
};

function found(command: string): boolean {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

/**
 * Writes an import map pinning Deno to the versions that are installed, which are the ones Bun and Node
 * load, and returns the flag that points at it. Left to resolve npm for itself Deno would satisfy the
 * `package.json` ranges independently, and a column that loaded a different MikroORM would be pricing that
 * rather than the runtime.
 */
function denoImportMap(): string {
  const { devDependencies } = readJson<{ devDependencies: Record<string, string> }>(resolve(root, 'package.json'));

  // The bare name and the subpath prefix are separate specifiers: `uql-orm` and `uql-orm/postgres`.
  const imports = Object.keys(devDependencies).flatMap((name) => {
    const version = installedVersion(name);
    return version
      ? [
          [name, `npm:${name}@${version}`],
          [`${name}/`, `npm:/${name}@${version}/`],
        ]
      : [];
  });

  const path = resolve(BUILD_DIR, 'deno-imports.json');
  writeJson(path, { imports: Object.fromEntries(imports) });
  return `--import-map=${path}`;
}

function runOn(runtime: RuntimeName, bundlePath: string, iterations: number): Run {
  const out = resolve(BUILD_DIR, `${runtime}.json`);
  const { command, args } = RUNTIMES[runtime];
  // `--portable`: Bun would otherwise measure three entries the others cannot, carrying more work per round
  // than they do, and its tail would answer for that instead of for Bun.
  const flags = ['--portable', '--iterations', String(iterations), '--json', out];
  return spawnJson<Run>(runtime, command, [...args(bundlePath), ...flags], out);
}

async function main() {
  // Far more rounds than the median tables need: a p99 drawn from 250 rounds is the third slowest of them,
  // which moves by milliseconds between runs. 2000 puts twenty rounds behind the figure instead of two.
  const iterations = Number(arg('iterations') ?? 2000);
  const bundlePath = await bundleForNode('scripts/flow-bench.ts');

  const runs: Run[] = [];
  for (const runtime of Object.keys(RUNTIMES) as RuntimeName[]) {
    if (!found(RUNTIMES[runtime].command)) {
      console.log(`\n${runtime} not installed, skipping\n`);
      continue;
    }
    console.log(`\n=== ${runtime} ===`);
    runs.push(runOn(runtime, bundlePath, iterations));
  }

  if (runs.length < 2) {
    throw new Error('a runtime comparison needs at least two runtimes installed');
  }

  syncRuntimeReport(runs);
  console.log(`\nREADME.md runtime blocks updated from ${runs.map((r) => r.runtime.label).join(', ')}`);
}

await main();
