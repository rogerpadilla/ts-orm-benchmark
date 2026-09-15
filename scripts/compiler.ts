/**
 * The compiler both halves of the benchmark check with, and how its errors are read back: the type-safety
 * check compiles its probes with it, the rename-safety check its renamed copies, and renames through its
 * language server.
 */

import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { root } from './project';

/**
 * The compiler this repo already builds with, and only that one, so a mark is what a reader's own editor
 * would say rather than what some pinned older toolchain would. Pinning 5.9.3 alongside was tried and
 * dropped: how it differs is a settled fact, in README.md's type-safety section, not something a run finds.
 */
export const COMPILER = { pkg: 'typescript', bin: resolve(root, 'node_modules/typescript/bin/tsc') } as const;

/** One error, by its absolute file and 1-based line. */
export type Diagnostic = { file: string; line: number; text: string };

/** `path(line,col): error TSxxxx: message`, with `--pretty false`. */
const DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/;

export function compile(project: string): Diagnostic[] {
  const { status, stdout, stderr } = spawnSync(process.execPath, [COMPILER.bin, '-p', project, '--pretty', 'false'], {
    cwd: root,
    encoding: 'utf8',
  });
  const output = `${stdout}${stderr}`;
  const diagnostics = output.split('\n').flatMap((line) => {
    const match = DIAGNOSTIC.exec(line);
    return match ? [{ file: resolve(root, match[1]), line: Number(match[2]), text: match[3] }] : [];
  });
  if (status !== 0 && !diagnostics.length) {
    throw new Error(`tsc -p ${project} failed without naming a line:\n${output}`);
  }
  return diagnostics;
}

export const listed = (label: string, diagnostics: readonly Diagnostic[]) =>
  `${label}\n${diagnostics.map((d) => `  ${relative(root, d.file)}:${d.line} ${d.text}`).join('\n')}`;
