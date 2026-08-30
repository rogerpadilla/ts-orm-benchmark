/**
 * Lifts each entry's step out of `scripts/flows.ts` so the README can show the query it timed. Read from
 * the source rather than written twice: a sample that is copied is a sample that goes stale, and the one
 * thing a reader has to be able to trust here is that the code shown is the code that ran.
 *
 * The parse leans on the file being Biome-formatted, which it is, and throws rather than guesses.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTRIES, type Entry, type Step } from './model';
import { root } from './project';

const FLOWS_PATH = 'scripts/flows.ts';

/** Every shape the `FLOWS` map uses: `Sequelize: sequelizeFlow,` and `UQL: (c) => uqlFlow(c.uql),`. */
const WIRING = /^ {2}(?:'([^']+)'|([\w$]+)):.*?\b(\w+Flow)\b/;

const source = () => readFileSync(resolve(root, FLOWS_PATH), 'utf8').split('\n');

/** Entry to the builder it is wired to, so two entries on one builder can be shown once. */
export function flowOf(): Map<Entry, string> {
  const inside = section(source(), 'export const FLOWS', '};');
  const pairs = inside.flatMap((line) => {
    const match = WIRING.exec(line);
    return match ? [[(match[1] ?? match[2]) as Entry, match[3]] as const] : [];
  });
  const wired = new Map(pairs);
  const missing = ENTRIES.filter((entry) => !wired.has(entry));
  if (missing.length) {
    throw new TypeError(`${FLOWS_PATH}: nothing this can read wires up ${missing.join(', ')}`);
  }
  return wired;
}

/** The lines between a line starting with `open` and the next line equal to `close`, both excluded. */
function section(lines: string[], open: string, close: string): string[] {
  const start = lines.findIndex((line) => line.startsWith(open));
  if (start < 0) {
    throw new TypeError(`${FLOWS_PATH} has no ${open}`);
  }
  const end = lines.findIndex((line, i) => i > start && line === close);
  if (end < 0) {
    throw new TypeError(`${FLOWS_PATH}: ${open} is never closed by ${close}`);
  }
  return lines.slice(start + 1, end);
}

const dedent = (lines: string[], by: number) => lines.map((line) => line.slice(by));

/**
 * One step of one builder, as it is written: everything from `run:` to the next sibling key. `rows` and
 * `children` are left out on purpose - they read a count out of the return value after the timer has
 * stopped, and showing them beside the query would suggest they are part of it.
 */
export function sampleOf(flow: string, step: Step): string {
  const body = section(source(), `function ${flow}(`, '}');
  const inStep = section(body, `    ${step}: {`, '    },');
  const from = inStep.findIndex((line) => line.startsWith('      run:'));
  if (from < 0) {
    throw new TypeError(`${FLOWS_PATH}: ${flow}'s ${step} has no run`);
  }
  const next = inStep.findIndex((line, i) => i > from && /^ {6}\w+:/.test(line));
  const lines = dedent(inStep.slice(from, next < 0 ? undefined : next), 6);
  return unwrap(
    lines
      .join('\n')
      .replace(/^run:\s*/, '')
      .replace(/,$/, ''),
  );
}

/**
 * Drops the `() =>` the step is stored behind. It is there so the harness can call the query rather than
 * hold its result, and it is the one part of a sample that is about the harness instead of about the ORM.
 */
function unwrap(body: string): string {
  const stripped = body.replace(/^(?:async )?\(\) =>[^\S\n]*/, '');
  return stripped.startsWith('\n') ? dedent(stripped.slice(1).split('\n'), 2).join('\n') : stripped;
}
