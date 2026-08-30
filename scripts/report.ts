/**
 * Renders the generated blocks of README.md and `results.js` from one {@link Run}. Every figure the prose
 * carries is computed here rather than typed, so a re-run cannot leave a stale number behind.
 */

import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import {
  ASSERTED_ONLY_STEPS,
  BASELINES,
  competitorsOf,
  ENTRIES,
  type Entry,
  PUBLISHED_STEPS,
  parseEntry,
  type Row,
  type Run,
  rank,
  rowFor,
  STEPS,
  type Step,
  stepOf,
} from './model';
import { installedVersion, root, writeReadme } from './project';
import { flowOf, sampleOf } from './samples';

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

export function linkEntry(entry: string): string {
  const url = TOOLS[parseEntry(entry).base]?.url;
  return url ? `[${entry}](${url})` : entry;
}

/** Every generated table goes through here, so a separator row can never drift from its header. */
export function mdTable(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

const stepValues = (ranked: Row[], step: Step) => ranked.map((r) => stepOf(r, step));

/**
 * The published steps only, same entry order as the ranking table so the two agree on who is winning.
 * Total stays the whole lifecycle, which is what the ranking and the floors are built on.
 */
function stepTable(ranked: Row[]): string {
  const cells = (values: number[]) => {
    const best = Math.min(...values.filter((_, i) => !ranked[i].isBaseline));
    return values.map((v, i) => (v === best && !ranked[i].isBaseline ? `**${v}** 🥇` : `${v}`));
  };

  return mdTable(
    ['Operation (µs)', ...ranked.map((r) => linkEntry(r.entry))],
    [
      ...PUBLISHED_STEPS.map((step) => [STEP_LABELS[step], ...cells(stepValues(ranked, step))]),
      [`**Total**, all ${STEPS.length} steps`, ...cells(ranked.map((r) => r.total))],
    ],
  );
}

/**
 * The two things to say about the table above: which step spreads the field most, and what the steps it
 * leaves out actually cost, so the omission is a figure rather than a claim.
 */
function stepsNote(ranked: Row[]): string {
  const competitors = competitorsOf(ranked);
  const worst = competitors
    .flatMap((r) => PUBLISHED_STEPS.map((step) => ({ entry: r.entry, step, value: stepOf(r, step) })))
    .reduce((a, b) => (b.value > a.value ? b : a));
  const others = stepValues(
    competitors.filter((r) => r.entry !== worst.entry),
    worst.step,
  );

  const sums = competitors.map((r) => ASSERTED_ONLY_STEPS.reduce((sum, step) => sum + stepOf(r, step), 0));
  const tightest = Math.max(
    ...ASSERTED_ONLY_STEPS.map((step) => {
      const values = stepValues(competitors, step);
      return Math.max(...values) - Math.min(...values);
    }),
  );

  return (
    `The biggest gap is ${worst.entry}'s ${worst.step}: ${worst.value}µs against ` +
    `${Math.min(...others)}-${Math.max(...others)}µs for everyone else. The other ` +
    `${ASSERTED_ONLY_STEPS.length} steps are asserted every round but not published: they are round trips ` +
    `with almost nothing in them, worth ${Math.min(...sums)}-${Math.max(...sums)}µs of each total and ` +
    `separating the field by at most ${tightest}µs.`
  );
}

function rankingTable(ranked: Row[]): string {
  const medals = ['🥇', '🥈', '🥉'];
  const competitors = competitorsOf(ranked);

  const rows = ranked.map((r) => {
    const place = competitors.indexOf(r) + 1;
    const position = r.isBaseline ? 'ref' : `${medals[place - 1] ?? ''} ${place}`.trim();
    const name = r.isBaseline ? `_${r.entry}_` : place === 1 ? `**${r.entry}**` : r.entry;
    return [position, name, r.isBaseline ? 'floor' : `+${r.adds}`, `${r.total}`];
  });

  return mdTable(['#', 'Entry', 'Adds µs', 'Total µs'], rows);
}

/**
 * Generated, so the paragraph carrying the numbers cannot drift from the table. Second half is the only
 * way to price a driver apart from the ORM: the same query builder on both.
 */
function headline(ranked: Row[]): string {
  const competitors = competitorsOf(ranked);
  const lowest = competitors[0];
  const highest = competitors[competitors.length - 1];
  const totals = competitors.map((r) => r.total);
  const spread = (Math.max(...totals) / Math.min(...totals)).toFixed(1);
  const floors = rowFor(ranked, 'raw pg').total - rowFor(ranked, 'bun sql').total;
  const pg = rowFor(ranked, 'UQL');
  const bun = rowFor(ranked, 'UQL (bunSql)');

  return (
    `Totals only span ${spread}x, because every entry pays the same database cost. What the ORM itself ` +
    `adds spans ${(highest.adds / lowest.adds).toFixed(0)}x: ${lowest.adds}µs for ${lowest.entry}, ` +
    `${highest.adds}µs for ${highest.entry}.\n\n` +
    `Each entry is measured against its own driver's floor, so a faster driver is never counted as the ` +
    `ORM's win. Running the same UQL code on Bun SQL instead of \`pg\` saves ${pg.total - bun.total}µs, ` +
    `but only ${pg.adds - bun.adds}µs of that is UQL: the other ${floors}µs is the gap between the two ` +
    `floors, free to anything on that driver.`
  );
}

/**
 * Generated with the numbers, so the line describing the run cannot drift from the run that produced
 * it. Naming the wrong runtime here once misattributed every figure below.
 */
export function envFacts(run: Run) {
  return {
    postgres: run.postgres,
    runtime: run.runtime.label,
    machine: cpus()[0]?.model ?? 'unknown CPU',
    when: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    /** Widest relative half-width across entries, so one figure can stand for the whole table. */
    interval: Math.max(...run.spreads),
  };
}

/** The run and its confidence in one caption, so a table of medians never stands without its error bar. */
function envLine(run: Run, ranked: Row[]): string {
  const { postgres, runtime, machine, when } = envFacts(run);
  const worst = ranked.reduce((a, b) => (b.spread > a.spread ? b : a));
  return (
    `> ${postgres}, ${runtime}, ${machine}, ${when}. Median µs per operation over ${run.iterations} ` +
    `rounds, after ${run.warmup} warmup rounds, interleaved and rotated. Every median is ` +
    `±${(worst.spread * 100).toFixed(1)}% or tighter at 95% confidence (widest: ${worst.entry}).`
  );
}

/**
 * The published steps as they are actually written, one fence per step, lifted out of `scripts/flows.ts`.
 * Entries wired to the same builder share a snippet, because they are the same code: `UQL (bunSql)` is
 * UQL reached through a second driver, not a second way of writing the query.
 */
function samples(ranked: Row[]): string {
  const flows = flowOf();
  // Ranked order, so a reader scrolling down from the per-step table meets the entries in the order it
  // just showed them. `ENTRIES` is run order, which is rotation bookkeeping and matches nothing on screen.
  const order = ranked.map((r) => r.entry);
  const flowFor = (entry: Entry) => {
    const flow = flows.get(entry);
    if (!flow) {
      throw new TypeError(`${entry} is ranked but not wired into FLOWS`);
    }
    return flow;
  };

  return PUBLISHED_STEPS.map((step) => {
    const shown = [...new Set(order.map(flowFor))].map((flow) => {
      const entries = order.filter((entry) => flowFor(entry) === flow);
      return `// ${entries.join(', ')}\n${sampleOf(flow, step)}`;
    });
    return `**${STEP_LABELS[step]}**\n\n\`\`\`ts\n${shown.join('\n\n')}\n\`\`\``;
  }).join('\n\n');
}

/** Six versions are a sentence, not a table, and they belong next to the numbers they produced. */
function versionsLine(): string {
  const tools = Object.entries(TOOLS).flatMap(([entry, { pkg }]) =>
    pkg ? [`${linkEntry(entry)} ${installedVersion(pkg)}`] : [],
  );

  return `_Versions: ${tools.join(' · ')}._`;
}

/** `adds` is precomputed so the chart never has to know which floor belongs to which entry. */
function resultsJs(run: Run, ranked: Row[]): string {
  const inRunOrder = run.entries.map((entry) => rowFor(ranked, entry));
  const payload = {
    entries: run.entries,
    baselines: BASELINES,
    steps: PUBLISHED_STEPS.map((key) => ({ key, label: STEP_LABELS[key] })),
    /** All seven, not only the published ones: the chart draws `steps`, this is the whole run. */
    data: run.results,
    totals: inRunOrder.map((r) => r.total),
    adds: inRunOrder.map((r) => r.adds),
    /** So the chart states the same run the tables do, instead of a hand-kept caption. */
    env: envFacts(run),
  };
  return [
    '// Auto-generated by scripts/flow-bench.ts: do not edit manually',
    `window.BENCH = ${JSON.stringify(payload, null, 2)};`,
    '',
  ].join('\n');
}

export function syncResults(run: Run): void {
  if (run.entries.length !== ENTRIES.length) {
    throw new TypeError(`only a full run publishes results; this one measured ${run.entries.length} entries`);
  }

  const ranked = rank(run);
  writeFileSync(resolve(root, 'results.js'), resultsJs(run, ranked));
  writeReadme({
    env: envLine(run, ranked),
    versions: versionsLine(),
    ranking: rankingTable(ranked),
    headline: headline(ranked),
    steps: stepTable(ranked),
    'steps-note': stepsNote(ranked),
    samples: samples(ranked),
  });
}

export function printSummary(run: Run): void {
  for (const r of rank(run)) {
    const cost = r.isBaseline ? 'floor' : `+${r.adds}µs`;
    const total = `${r.total}µs`.padStart(8);
    console.log(`${r.entry.padEnd(18)} ${total} ${cost.padEnd(9)} p50 ${r.tail.p50} p99 ${r.tail.p99}`);
  }
}
