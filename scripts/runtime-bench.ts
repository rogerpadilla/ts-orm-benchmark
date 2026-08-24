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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RuntimeName } from '../src/runtime';
import type { Run } from './model';
import { arg, installedVersion, root } from './project';
import { syncRuntimeReport } from './runtime-report';

/** Sits one level below the root, like `scripts`, so the bundle resolves the same paths its source did. */
const BUILD_DIR = resolve(root, '.bench-build');

type Runner = { command: string; args: (bundle: string) => string[] };

/** Bun first: it is the only runtime that can run every entry, so its ranking orders the table. */
const RUNTIMES: Record<RuntimeName, Runner> = {
  bun: { command: 'bun', args: (bundle) => [bundle] },
  node: { command: 'node', args: (bundle) => [bundle] },
  deno: {
    command: 'deno',
    // `--node-modules-dir=none`: Deno's own layout relinks the installed `node_modules` underneath itself,
    // which leaves Bun, Node and every editor resolving a different tree. It reads the import map instead.
    args: (bundle) => ['run', '--allow-all', '--node-modules-dir=none', '--no-lock', denoImportMap(), bundle],
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
  const { devDependencies } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
  };

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
  writeFileSync(path, `${JSON.stringify({ imports: Object.fromEntries(imports) }, null, 2)}\n`);
  return `--import-map=${path}`;
}

/** `--packages=external` so every entry is the same installed dependency each runtime would load itself. */
async function bundle(): Promise<string> {
  mkdirSync(BUILD_DIR, { recursive: true });
  const built = await Bun.build({
    entrypoints: [resolve(root, 'scripts/flow-bench.ts')],
    outdir: BUILD_DIR,
    target: 'node',
    packages: 'external',
  });
  if (!built.success) {
    throw new AggregateError(built.logs, 'bundling the flow benchmark failed');
  }
  return built.outputs[0].path;
}

function runOn(runtime: RuntimeName, bundlePath: string, iterations: number): Run {
  const out = resolve(BUILD_DIR, `${runtime}.json`);
  const { command, args } = RUNTIMES[runtime];
  // `--portable`: Bun would otherwise measure three entries the others cannot, carrying more work per round
  // than they do, and its tail would answer for that instead of for Bun.
  const flags = ['--portable', '--iterations', String(iterations), '--json', out];
  const result = spawnSync(command, [...args(bundlePath), ...flags], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    throw new Error(`${runtime} exited with ${result.status ?? result.signal}`);
  }
  return JSON.parse(readFileSync(out, 'utf8')) as Run;
}

async function main() {
  // Far more rounds than the median tables need: a p99 drawn from 250 rounds is the third slowest of them,
  // which moves by milliseconds between runs. 2000 puts twenty rounds behind the figure instead of two.
  const iterations = Number(arg('iterations') ?? 2000);
  const bundlePath = await bundle();

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
