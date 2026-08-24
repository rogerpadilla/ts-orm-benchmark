/**
 * The few things that touch this repository's own files: where it is, what is installed in it, and how the
 * generated blocks of README.md are replaced. Everything measured or rendered lives elsewhere.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

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
