/**
 * Renders the rename-safety blocks of README.md, and the results uql-orm.dev reads, from one set of
 * {@link RenameResults}. The renaming and scoring is `scripts/rename-check.ts`.
 */

import { resolve } from 'node:path';
import { COMPILER } from './compiler';
import { installedVersion, root, writeJson, writeReadme } from './project';
import {
  RENAME_GROUPS,
  RENAME_PROBES,
  RENAME_VERDICTS,
  type RenameMention,
  type RenameVerdict,
  RENAMES,
} from './renames';
import { alphabetical, linkEntry, list, mdTable } from './render';

/** Each entry's mentions, in {@link RENAME_PROBES} order. */
export type RenameResults = Map<string, RenameMention[]>;

export const VERDICTS = 'rename-safety/verdicts.json';

const MARK: Record<RenameVerdict, string> = { followed: '✅', flagged: '⚠️', silent: '❌', 'n/a': '-' };

const TOTALS: [RenameVerdict, string][] = [
  ['followed', '**Followed**'],
  ['flagged', '**Flagged by the compiler**'],
  ['silent', '**Silently left behind**'],
];

const count = (mentions: RenameMention[], verdict: RenameVerdict) =>
  mentions.filter((mention) => mention.verdict === verdict).length;

/** The language servers that did the renaming, as installed. */
export const renameTooling = () => ({
  typescript: installedVersion(COMPILER.pkg),
  prismaLanguageServer: installedVersion('@prisma/language-server'),
});

function table(results: RenameResults): string {
  const order = alphabetical(results);
  const groups = Object.entries(RENAME_GROUPS).flatMap(([group, label]) => [
    [`**${label}**`, ...order.map(() => '')],
    ...RENAME_PROBES.flatMap((probe, i) =>
      probe.group === group ? [[probe.what, ...order.map(([, mentions]) => MARK[mentions[i].verdict])]] : [],
    ),
  ]);
  return mdTable(
    ['Mention', ...order.map(([entry]) => linkEntry(entry))],
    [
      ...groups,
      ...TOTALS.map(([verdict, label]) => [label, ...order.map(([, mentions]) => String(count(mentions, verdict)))]),
    ],
  );
}

function note(results: RenameResults): string {
  const order = alphabetical(results);
  const clean = order.filter(([, mentions]) => !count(mentions, 'silent')).map(([entry]) => entry);
  const worst = order.reduce((a, b) => (count(b[1], 'silent') > count(a[1], 'silent') ? b : a));
  const lead = clean.length
    ? `${list(clean)} ${clean.length > 1 ? 'leave' : 'leaves'} nothing behind silently`
    : 'Every entry leaves something behind silently';
  return (
    `${lead}; ${worst[0]} leaves ${count(worst[1], 'silent')} of the ${RENAME_PROBES.length}. A mention left ` +
    `behind silently still compiles, and breaks when the code runs or the schema migrates.`
  );
}

export function printRenameSummary(results: RenameResults): void {
  for (const [entry, mentions] of alphabetical(results)) {
    const cells = RENAME_VERDICTS.map((verdict) => `${verdict} ${String(count(mentions, verdict)).padStart(2)}`);
    console.log(`${entry.padEnd(10)} ${cells.join(', ')}`);
  }
}

/**
 * The README blocks and, in {@link VERDICTS}, every mention with its verdict and where it is: uql-orm.dev
 * marks the files with them as they are, rather than scoring anything itself.
 */
export function syncRenameReport(results: RenameResults): void {
  const tooling = renameTooling();
  const renames = list(RENAMES.map(({ from, to }) => `\`${from}\` to \`${to}\``));
  writeReadme({
    'rename-safety': table(results),
    'rename-safety-note': note(results),
    'rename-safety-env': `> Renamed ${renames}, with TypeScript ${tooling.typescript} and prisma-language-server ${tooling.prismaLanguageServer}.`,
  });
  writeJson(resolve(root, VERDICTS), {
    ...tooling,
    renames: RENAMES,
    groups: RENAME_GROUPS,
    probes: RENAME_PROBES,
    entries: Object.fromEntries(alphabetical(results)),
  });
}
