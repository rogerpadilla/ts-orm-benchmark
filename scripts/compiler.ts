/**
 * The compiler both halves of the benchmark check with, and how its errors are read back: the type-safety
 * check compiles its probes with it, the rename-safety check its renamed copies, and renames through its
 * language server.
 */

import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
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

/** Runs a process to completion from the repo root; `output` is its stdout and stderr together. */
function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const { status, stdout, stderr } = spawnSync(command, args, { cwd: root, encoding: 'utf8', env });
  return { status, stdout, output: `${stdout}${stderr}` };
}

const tsc = (args: string[]) => run(process.execPath, [COMPILER.bin, ...args]);

export function compile(project: string): Diagnostic[] {
  const { status, output } = tsc(['-p', project, '--pretty', 'false']);
  const diagnostics = output.split('\n').flatMap((line) => {
    const match = DIAGNOSTIC.exec(line);
    return match ? [{ file: resolve(root, match[1]), line: Number(match[2]), text: match[3] }] : [];
  });
  if (status !== 0 && !diagnostics.length) {
    throw new Error(`tsc -p ${project} failed without naming a line:\n${output}`);
  }
  return diagnostics;
}

/**
 * What the checker instantiates compiling `file` alone, in the project of `dir`: the type cost a definition puts on
 * every build, and deterministic where check time is not.
 */
export function instantiations(dir: string, file: string): number {
  const project = resolve(dir, 'tsconfig.weigh.json');
  writeFileSync(project, JSON.stringify({ extends: './tsconfig.json', include: [], files: [file] }));
  try {
    const { output } = tsc(['-p', project, '--extendedDiagnostics']);
    const counted = /^Instantiations:\s+(\d+)/m.exec(output);
    if (!counted) {
      throw new Error(`tsc reported no instantiations for ${file}:\n${output}`);
    }
    return Number(counted[1]);
  } finally {
    rmSync(project, { force: true });
  }
}

export const listed = (label: string, diagnostics: readonly Diagnostic[]) =>
  `${label}\n${diagnostics.map((d) => `  ${relative(root, d.file)}:${d.line} ${d.text}`).join('\n')}`;

/** Validates a schema and, unless `generate` is off, generates its client when it is valid; each error by its line. */
export function validateSchema(schema: string, { generate = true } = {}): Diagnostic[] {
  const prisma = (command: string) =>
    run(resolve(root, 'node_modules/.bin/prisma'), [command, '--schema', schema], { ...process.env, NO_COLOR: '1' });
  const validated = prisma('validate');
  const errors = [...validated.output.matchAll(/^error: (.+)\n\s*-->\s+.*?:(\d+)/gm)].map((match) => ({
    file: schema,
    line: Number(match[2]),
    text: match[1],
  }));
  if (validated.status !== 0 && !errors.length) {
    throw new Error(`prisma validate failed without naming a line:\n${validated.output}`);
  }
  if (errors.length || !generate) {
    return errors;
  }
  const generated = prisma('generate');
  if (generated.status !== 0) {
    throw new Error(`prisma generate failed:\n${generated.output}`);
  }
  return [];
}
