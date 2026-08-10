import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * `raw pg` and `bun sql` are hand-written driver code with manual row mapping: reference floors, not
 * competitors. The `(bunSql)` rows are the same query builder on a different driver, which only UQL and
 * Drizzle ship an adapter for.
 */
export const ENTRIES = [
  'raw pg',
  'bun sql',
  'UQL',
  'UQL (bunSql)',
  'Sequelize',
  'TypeORM',
  'MikroORM',
  'Drizzle',
  'Drizzle (bunSql)',
  'Prisma',
] as const;

export const BASELINES = ['raw pg', 'bun sql'] as const;

export const STEPS = ['insert', 'read', 'update', 'readAgain', 'nested', 'delete', 'readEmpty'] as const;

export type Entry = (typeof ENTRIES)[number];
export type Step = (typeof STEPS)[number];

/** Median µs per step, index-aligned with {@link ENTRIES}. */
export type Results = Record<Step, number[]>;

const STEP_LABELS: Record<Step, string> = {
  insert: 'INSERT 10 rows, returning ids',
  read: 'SELECT with WHERE, SORT, LIMIT 200',
  update: 'UPDATE by id',
  readAgain: 'SELECT to verify the update',
  nested: 'SELECT 50 parents with their children',
  delete: 'DELETE by id',
  readEmpty: 'SELECT to verify the delete',
};

/**
 * Keyed by entry name without its driver suffix, so `UQL` and `UQL (bunSql)` resolve to the same row.
 * `pkg` is where the version comes from, read from `node_modules` rather than hand-kept; the floors are
 * hand-written driver code, so they have no package and no version to report.
 */
const TOOLS: Record<string, { url: string; pkg?: string }> = {
  UQL: { url: 'https://uql-orm.dev', pkg: 'uql-orm' },
  Prisma: { url: 'https://www.prisma.io', pkg: 'prisma' },
  Sequelize: { url: 'https://sequelize.org', pkg: 'sequelize' },
  TypeORM: { url: 'https://typeorm.io', pkg: 'typeorm' },
  MikroORM: { url: 'https://mikro-orm.io', pkg: '@mikro-orm/postgresql' },
  Drizzle: { url: 'https://orm.drizzle.team', pkg: 'drizzle-orm' },
  'raw pg': { url: 'https://node-postgres.com' },
  'bun sql': { url: 'https://bun.sh/docs/api/sql' },
};

/** Each entry is measured against its own driver, so a faster driver is not counted as the tool's doing. */
function floorFor(entry: string): Entry {
  return entry.includes('(bunSql)') ? 'bun sql' : 'raw pg';
}

const isBaseline = (entry: string) => (BASELINES as readonly string[]).includes(entry);

function linkEntry(entry: string): string {
  const url = TOOLS[entry.replace(/\s*\(.+\)$/, '')]?.url;
  return url ? `[${entry}](${url})` : entry;
}

export function totalOf(results: Results, entryIndex: number): number {
  return STEPS.reduce((sum, step) => sum + results[step][entryIndex], 0);
}

/**
 * What the tool itself costs. Absolute, not a percentage of the floor: the floors differ, so the same work
 * against a faster floor reads as a larger percentage.
 */
export function overheadUs(results: Results, entryIndex: number): number {
  const floor = totalOf(results, ENTRIES.indexOf(floorFor(ENTRIES[entryIndex])));
  return totalOf(results, entryIndex) - floor;
}

export type Ranking = { entry: Entry; isBaseline: boolean; total: number; adds: number; steps: number[] };

/** Floors first as the reference, then competitors by what they add. */
export function rank(results: Results): Ranking[] {
  const rankings: Ranking[] = ENTRIES.map((entry, i) => ({
    entry,
    isBaseline: isBaseline(entry),
    total: totalOf(results, i),
    adds: overheadUs(results, i),
    steps: STEPS.map((step) => results[step][i]),
  }));

  return [
    ...rankings.filter((r) => r.isBaseline).sort((a, b) => a.total - b.total),
    ...rankings.filter((r) => !r.isBaseline).sort((a, b) => a.adds - b.adds),
  ];
}

/** Same order as the ranking table, so the two agree on who's winning. */
function stepTable(results: Results): string {
  const rankings = rank(results);

  const cells = (values: number[]) => {
    const best = Math.min(...values.filter((_, i) => !rankings[i].isBaseline));
    return values.map((v, i) => (v === best && !rankings[i].isBaseline ? `**${v}** 🥇` : `${v}`));
  };

  const rows = STEPS.map(
    (step, s) => `| ${STEP_LABELS[step]} | ${cells(rankings.map((r) => r.steps[s])).join(' | ')} |`,
  );

  return [
    `| Operation (µs) | ${rankings.map((r) => linkEntry(r.entry)).join(' | ')} |`,
    `| --- | ${rankings.map(() => '---').join(' | ')} |`,
    ...rows,
    `| **Total** | ${cells(rankings.map((r) => r.total)).join(' | ')} |`,
  ].join('\n');
}

function rankingTable(results: Results): string {
  const medals = ['🥇', '🥈', '🥉'];
  const rankings = rank(results);
  const competitors = rankings.filter((r) => !r.isBaseline);

  const rows = rankings.map((r) => {
    const place = competitors.indexOf(r) + 1;
    const position = r.isBaseline ? 'ref' : `${medals[place - 1] ?? ''} ${place}`.trim();
    const name = r.isBaseline ? `_${r.entry}_` : place === 1 ? `**${r.entry}**` : r.entry;
    return `| ${position} | ${name} | ${r.isBaseline ? 'floor' : `+${r.adds}`} | ${r.total} |`;
  });

  return ['| # | Entry | Adds µs | Total µs |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

/** Generated, so the one sentence carrying numbers cannot drift from the tables. */
function headline(results: Results): string {
  const competitors = rank(results).filter((r) => !r.isBaseline);
  const lowest = competitors[0];
  const highest = competitors[competitors.length - 1];
  const totals = competitors.map((r) => r.total);
  const spread = (Math.max(...totals) / Math.min(...totals)).toFixed(1);

  return (
    `Totals span ${spread}x because every entry pays the same database cost. The part above the floor, ` +
    `which is the ORM's own, spans ${(highest.adds / lowest.adds).toFixed(0)}x: ${lowest.adds}µs for ` +
    `${lowest.entry} against ${highest.adds}µs for ${highest.entry}.`
  );
}

/** Six versions are a sentence, not a table, and they belong next to the numbers they produced. */
function versionsLine(): string {
  const tools = Object.entries(TOOLS).flatMap(([entry, { pkg }]) => {
    if (!pkg) return [];
    const manifest = resolve(root, 'node_modules', pkg, 'package.json');
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
    return [`${linkEntry(entry)} ${version}`];
  });

  return `_Versions: ${tools.join(' · ')}._`;
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

/** `adds` is precomputed so the chart never has to know which floor belongs to which entry. */
function resultsJs(results: Results): string {
  const payload = {
    unit: 'µs/op',
    entries: ENTRIES,
    baselines: BASELINES,
    steps: STEPS.map((key) => ({ key, label: STEP_LABELS[key] })),
    data: results,
    totals: ENTRIES.map((_, i) => totalOf(results, i)),
    adds: ENTRIES.map((_, i) => overheadUs(results, i)),
  };
  return [
    '// Auto-generated by scripts/flow-bench.ts: do not edit manually',
    `window.BENCH = ${JSON.stringify(payload, null, 2)};`,
    '',
  ].join('\n');
}

export function syncResults(results: Results): void {
  writeFileSync(resolve(root, 'results.js'), resultsJs(results));

  const readmePath = resolve(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  let out = replaceMarked(readme, 'ranking', rankingTable(results));
  out = replaceMarked(out, 'headline', headline(results));
  out = replaceMarked(out, 'steps', stepTable(results));
  writeFileSync(readmePath, replaceMarked(out, 'versions', versionsLine()));
}

export function printSummary(results: Results): void {
  for (const r of rank(results)) {
    console.log(r.entry.padEnd(18), `${r.total}µs`.padStart(8), r.isBaseline ? 'floor' : `+${r.adds}µs`);
  }
}
