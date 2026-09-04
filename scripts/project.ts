/**
 * The few things that touch this repository's own files: where it is, what is installed in it, and how the
 * generated blocks of README.md are replaced. Everything measured or rendered lives elsewhere.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Sits one level below the root, like `scripts`, so a bundle resolves the same paths its source did. */
export const BUILD_DIR = resolve(root, '.bench-build');

/**
 * Bundles one script for Node and returns the path. `--packages=external` so the bundle loads the same
 * installed dependencies Bun does rather than a copy inlined at build time.
 *
 * Both benchmarks that leave this process need it: the runtime comparison to put one build in front of
 * three runtimes, the memory one to give every entry a process of its own. Bun-only, and only ever
 * called from the parent, so the bundles it produces can still run where there is no `Bun`.
 */
export async function bundleForNode(script: string): Promise<string> {
  mkdirSync(BUILD_DIR, { recursive: true });
  const built = await Bun.build({
    entrypoints: [resolve(root, script)],
    outdir: BUILD_DIR,
    target: 'node',
    packages: 'external',
  });
  if (!built.success) {
    throw new AggregateError(built.logs, `bundling ${script} failed`);
  }
  return built.outputs[0].path;
}

/** Reads command-line values as `--name value`; absent means the caller's default applies. */
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

/** What is on disk, never a hand-kept number: the report states the versions that produced the run. */
export function installedVersion(pkg: string): string | undefined {
  const manifest = resolve(root, 'node_modules', pkg, 'package.json');
  if (!existsSync(manifest)) {
    return undefined;
  }
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/** Rewrites the region between `<!-- bench:key -->` and `<!-- /bench:key -->`. */
function replaceMarked(markdown: string, key: string, body: string): string {
  const open = `<!-- bench:${key} -->`;
  const close = `<!-- /bench:${key} -->`;
  const start = markdown.indexOf(open);
  const end = markdown.indexOf(close);
  if (start < 0 || end < 0) {
    throw new TypeError(`README is missing the ${open} ... ${close} markers`);
  }
  return `${markdown.slice(0, start + open.length)}\n${body}\n${markdown.slice(end)}`;
}

/** Rewrites every named block in README.md in one pass. */
export function writeReadme(blocks: Record<string, string>): void {
  const readmePath = resolve(root, 'README.md');
  const out = Object.entries(blocks).reduce(
    (markdown, [key, body]) => replaceMarked(markdown, key, body),
    readFileSync(readmePath, 'utf8'),
  );
  writeFileSync(readmePath, out);
}
