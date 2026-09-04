/**
 * What a run is, what an entry is, and how a sample is summarised: the vocabulary and the statistics every
 * other script agrees on. Nothing here renders or times anything, so `scripts/report.ts` can be about
 * markdown and `scripts/flow-bench.ts` about the timing loop.
 */

import type { Runtime } from '../src/runtime';

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

/**
 * Every tool the report names, in one place. `pkg` is where its version is read from and `probe` is its
 * file in `type-safety/`; the two floors are hand-written driver code, so they have neither.
 *
 * One registry rather than three. `TOOLS`, the probe-file map and the version line used to be separate
 * lists that had to agree by convention: a probe file whose name did not match a key here still scored,
 * it just lost its link in the table, silently. Derived, that cannot happen.
 */
export const TOOLS: Record<string, { url: string; pkg?: string; probe?: string }> = {
  UQL: { url: 'https://uql-orm.dev', pkg: 'uql-orm', probe: 'uql' },
  Prisma: { url: 'https://www.prisma.io', pkg: 'prisma', probe: 'prisma' },
  Sequelize: { url: 'https://sequelize.org', pkg: 'sequelize', probe: 'sequelize' },
  TypeORM: { url: 'https://typeorm.io', pkg: 'typeorm', probe: 'typeorm' },
  MikroORM: { url: 'https://mikro-orm.io', pkg: '@mikro-orm/postgresql', probe: 'mikro-orm' },
  Drizzle: { url: 'https://orm.drizzle.team', pkg: 'drizzle-orm', probe: 'drizzle' },
  'raw pg': { url: 'https://node-postgres.com' },
  'bun sql': { url: 'https://bun.sh/docs/api/sql' },
};

/** Probe file stem to the name the timing tables use, so both halves call a tool the same thing. */
export const PROBE_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(TOOLS).flatMap(([entry, { probe }]) => (probe ? [[probe, entry]] : [])),
);

export const STEPS = ['insert', 'read', 'update', 'readAgain', 'nested', 'delete', 'readEmpty'] as const;

export type Entry = (typeof ENTRIES)[number];
export type Step = (typeof STEPS)[number];

/**
 * The steps whose timings are worth publishing: the three where how much data is bound and hydrated
 * decides the number. Every step is still run, in order, and still asserted.
 */
export const PUBLISHED_STEPS: Step[] = ['insert', 'read', 'nested'];

/** The rest are round trips with almost nothing in them, separating the field by tens of µs. */
export const ASSERTED_ONLY_STEPS: Step[] = STEPS.filter((step) => !PUBLISHED_STEPS.includes(step));

/** Median µs per step, index-aligned with the run's own {@link Run.entries}. */
export type Results = Record<Step, number[]>;

/** The one place that turns {@link STEPS} into a record keyed by them, so the cast lives here alone. */
export const byStep = <T>(of: (step: Step) => T) =>
  Object.fromEntries(STEPS.map((step) => [step, of(step)])) as Record<Step, T>;

/** Round-total µs: what one caller waits for a whole lifecycle, at the median and out in the tail. */
export type Tail = { p50: number; p99: number };

/**
 * One runtime's run and everything the report states about it, measured rather than hand-kept. Carried as
 * one object so no figure can be paired with the wrong run: the entry list is part of the run, because a
 * run off Bun has three entries fewer.
 */
export type Run = {
  runtime: Runtime;
  postgres: string;
  iterations: number;
  warmup: number;
  entries: Entry[];
  results: Results;
  /** Index-aligned with {@link Run.entries}. */
  tails: Tail[];
  /** Relative half-width of the median round total's 95% interval, index-aligned with {@link Run.entries}. */
  spreads: number[];
};

/**
 * One run of the memory benchmark: KB allocated per lifecycle, per step. Structurally a {@link Run}
 * without the timing statistics, because allocation has no tail worth reporting - a step allocates what
 * it allocates, and the samples that disagree are the ones a GC landed in, which are discarded not
 * averaged. {@link MemoryRun.discarded} is how many, so a quiet loss of samples cannot pass for a clean run.
 */
export type MemoryRun = {
  runtime: Runtime;
  postgres: string;
  iterations: number;
  warmup: number;
  entries: Entry[];
  results: Results;
  /** Share of samples a GC landed in, index-aligned with {@link MemoryRun.entries}. */
  discarded: number[];
  /** KB still held after every round has run and the heap has been collected, index-aligned likewise. */
  retained: number[];
};

/**
 * One entry's whole story in a run, so no renderer has to line up arrays by index again. Unitless: the
 * flow benchmark fills it with µs and the memory benchmark with KB, and both rank the same way.
 */
export type Row = {
  entry: Entry;
  isBaseline: boolean;
  /** Per-step median, aligned with {@link STEPS}. */
  steps: number[];
  /** Sum of the step medians. */
  total: number;
  /** What the tool itself costs: its total less its own driver's floor. */
  adds: number;
};

/** A timed row also carries what only a timing run has: where the slow rounds land, and how tight. */
export type TimedRow = Row & { tail: Tail; spread: number };

/** A timed row placed against the others: what its `adds` is known to within, and who is measurably faster. */
export type PlacedRow = TimedRow & { margin: number; place: number };

/** `Drizzle (bunSql)` is one tool reached through a second driver: same tool, different floor. */
export function parseEntry(entry: string): { base: string; variant?: string } {
  const match = /^(.*?)\s*\((.+)\)$/.exec(entry);
  return match ? { base: match[1], variant: match[2] } : { base: entry };
}

/** Bun's SQL client is a Bun API, so these have nothing to run on Node or Deno. */
const isBunOnly = (entry: string) => entry === 'bun sql' || parseEntry(entry).variant === 'bunSql';

/** What every runtime can load, and so the only set a cross-runtime comparison can be made of. */
export const PORTABLE_ENTRIES: Entry[] = ENTRIES.filter((entry) => !isBunOnly(entry));

/** Each entry is measured against its own driver, so a faster driver is not counted as the tool's doing. */
const floorFor = (entry: string): Entry => (isBunOnly(entry) ? 'bun sql' : 'raw pg');

export const isBaseline = (entry: string) => (BASELINES as readonly string[]).includes(entry);

/** Run order, one row per entry measured. {@link rank} is what orders them for the reader. */
function rows(entries: Entry[], results: Results): Row[] {
  const stepsOf = (i: number) => STEPS.map((step) => results[step][i]);
  const totals = entries.map((_, i) => stepsOf(i).reduce((sum, value) => sum + value, 0));
  const floorTotal = (entry: Entry) => {
    const floor = entries.indexOf(floorFor(entry));
    if (floor < 0) {
      throw new TypeError(`run has no ${floorFor(entry)} floor to measure ${entry} against`);
    }
    return totals[floor];
  };

  return entries.map((entry, i) => ({
    entry,
    isBaseline: isBaseline(entry),
    steps: stepsOf(i),
    total: totals[i],
    adds: totals[i] - floorTotal(entry),
  }));
}

/** Floors first as the reference, then competitors by what they add. */
const ordered = <T extends Row>(all: T[]): T[] => [
  ...all.filter((r) => r.isBaseline).sort((a, b) => a.total - b.total),
  ...all.filter((r) => !r.isBaseline).sort((a, b) => a.adds - b.adds),
];

/** A timing run, ranked, each row carrying where its slow rounds land and how tight its median is. */
export const rank = (run: Run): TimedRow[] =>
  ordered(rows(run.entries, run.results).map((row, i) => ({ ...row, tail: run.tails[i], spread: run.spreads[i] })));

/** A memory run, ranked. Nothing to carry: KB per step is the whole story. */
export const rankMemory = (run: MemoryRun): Row[] => ordered(rows(run.entries, run.results));

/**
 * Half-width of the 95% interval on `adds`, which is a difference of two measured medians, so the entry's
 * interval and its floor's add in quadrature rather than one of them standing for both.
 */
function marginOf(ranked: TimedRow[], row: TimedRow): number {
  const floor = rowFor(ranked, floorFor(row.entry));
  return Math.round(Math.hypot(row.spread * row.total, floor.spread * floor.total));
}

/**
 * Places assigned over intervals rather than over medians: an entry's place is one more than the number of
 * entries measurably faster than it, so two whose intervals overlap share a place instead of being ordered
 * by noise. Same rule LMArena ranks models by, and the reason this table has no 1-through-8 column.
 */
export function places(ranked: TimedRow[]): PlacedRow[] {
  const competitors = competitorsOf(ranked).map((row) => ({ ...row, margin: marginOf(ranked, row) }));
  const beats = (a: { adds: number; margin: number }, b: typeof a) => a.adds + a.margin < b.adds - b.margin;

  return competitors.map((row) => ({ ...row, place: 1 + competitors.filter((other) => beats(other, row)).length }));
}

/** {@link Row.steps} is aligned with {@link STEPS}; this is the only place that has to know it. */
export const stepOf = (row: Row, step: Step) => row.steps[STEPS.indexOf(step)];

export const competitorsOf = <T extends Row>(ranked: T[]): T[] => ranked.filter((r) => !r.isBaseline);

export function rowFor<T extends Row>(ranked: T[], entry: Entry): T {
  const row = ranked.find((r) => r.entry === entry);
  if (!row) {
    throw new TypeError(`run has no ${entry} row`);
  }
  return row;
}

export const sortedAsc = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** Median, not mean: one GC pause during a run would otherwise dominate the number. */
export function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank, so every percentile reported is a round that actually happened rather than an average. */
export function percentileIndex(count: number, percentile: number): number {
  return Math.min(count - 1, Math.ceil((percentile / 100) * count) - 1);
}

export const percentile = (sorted: number[], p: number) => sorted[percentileIndex(sorted.length, p)];

/** One total per measured round, sorted: what a caller waits for a whole lifecycle, tail included. */
export function sortedRoundTotals(sample: Record<Step, number[]>): number[] {
  return sortedAsc(sample[STEPS[0]].map((_, round) => STEPS.reduce((sum, step) => sum + sample[step][round], 0)));
}

export function tailFrom(totals: number[]): Tail {
  return {
    p50: Math.round(percentile(totals, 50)),
    p99: Math.round(percentile(totals, 99)),
  };
}

/**
 * Half-width of the distribution-free 95% confidence interval for an entry's median round total, relative
 * to that median: whether two entries' medians can be told apart at all. The slow tail is {@link tailFrom}.
 */
export function spreadOf(totals: number[]): number {
  const mid = totals.length >> 1;
  const half = Math.ceil((1.96 * Math.sqrt(totals.length)) / 2);
  const lo = totals[Math.max(0, mid - half)];
  const hi = totals[Math.min(totals.length - 1, mid + half)];
  return (hi - lo) / 2 / median(totals);
}
