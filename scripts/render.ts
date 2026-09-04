/**
 * What all four reports share: how a table is drawn, and what the caption above one says about the run
 * that produced it. Its own module so the three smaller reports do not have to import the flow report to
 * draw a table.
 */

import { cpus } from 'node:os';
import { parseEntry, type Run, TOOLS } from './model';

export function linkEntry(entry: string): string {
  const url = TOOLS[parseEntry(entry).base]?.url;
  return url ? `[${entry}](${url})` : entry;
}

/** Every generated table goes through here, so a separator row can never drift from its header. */
export function mdTable(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** The one convention every table here shares, in one place: the leading cell, and only it, is bold. */
export const bold = (text: string | number, leading: boolean) => (leading ? `**${text}**` : `${text}`);

/** Where a run happened, which every report's caption states and none of them should word twice. */
export const machineFacts = () => ({
  machine: cpus()[0]?.model ?? 'unknown CPU',
  when: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
});

/**
 * Generated with the numbers, so the line describing the run cannot drift from the run that produced it.
 * Naming the wrong runtime here once misattributed every figure below.
 */
export function envFacts(run: Run) {
  return {
    postgres: run.postgres,
    runtime: run.runtime.label,
    ...machineFacts(),
    /** Widest relative half-width across entries, so one figure can stand for the whole table. */
    interval: Math.max(...run.spreads),
  };
}
