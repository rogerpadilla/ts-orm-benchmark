/**
 * Renders the rename-safety blocks of README.md, and the results uql-orm.dev reads, from one set of
 * {@link RenameResults}. The renaming and scoring is `scripts/rename-check.ts`.
 */

import { resolve } from 'node:path';
import { installedVersion, root, writeJson, writeReadme } from './project';
import {
  RENAME_GROUPS,
  RENAME_PROBES,
  type RenameMention,
  type RenamePlayground,
  type RenameVerdict,
  RENAMES,
} from './renames';
import { alphabetical, linkEntry, list, mdTable } from './render';

/** Each entry's mentions, in {@link RENAME_PROBES} order. */
export type RenameResults = Map<string, RenameMention[]>;

const MARK: Record<RenameVerdict, string> = { followed: '✅', flagged: '⚠️', silent: '❌', 'n/a': '-' };

export const VERDICTS = 'rename-safety/verdicts.json';

const count = (mentions: RenameMention[], verdict: RenameVerdict) =>
  mentions.filter((mention) => mention.verdict === verdict).length;

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
      ['**Followed**', ...order.map(([, mentions]) => String(count(mentions, 'followed')))],
      ['**Flagged by the compiler**', ...order.map(([, mentions]) => String(count(mentions, 'flagged')))],
      ['**Silently left behind**', ...order.map(([, mentions]) => String(count(mentions, 'silent')))],
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
  const cell = (mentions: RenameMention[], verdict: RenameVerdict) =>
    `${verdict} ${String(count(mentions, verdict)).padStart(2)}`;
  for (const [entry, mentions] of alphabetical(results)) {
    console.log(
      `${entry.padEnd(10)} ${cell(mentions, 'followed')}, ${cell(mentions, 'flagged')}, ${cell(mentions, 'silent')}, ${cell(mentions, 'n/a')}`,
    );
  }
}

/**
 * The README blocks and, in {@link VERDICTS}, every mention with its code and its verdict, and the playground
 * excerpts scored the same way: uql-orm.dev shows them as they are, rather than scoring anything itself.
 */
export function syncRenameReport(results: RenameResults, playground: RenamePlayground): void {
  const renames = list(RENAMES.map(({ from, to }) => `\`${from}\` to \`${to}\``));
  writeReadme({
    'rename-safety': table(results),
    'rename-safety-note': note(results),
    'rename-safety-env': `> Renamed ${renames}, with TypeScript ${installedVersion('typescript')} and prisma-language-server ${installedVersion('@prisma/language-server')}.`,
  });
  writeJson(resolve(root, VERDICTS), {
    typescript: installedVersion('typescript'),
    prismaLanguageServer: installedVersion('@prisma/language-server'),
    renames: RENAMES,
    groups: RENAME_GROUPS,
    probes: RENAME_PROBES,
    entries: Object.fromEntries(alphabetical(results)),
    playground,
  });
  console.log(`\nREADME.md rename-safety blocks updated, results written to ${VERDICTS}`);
}
