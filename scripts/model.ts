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

/** One entry's whole story in a run, so no renderer has to line up arrays by index again. */
export type Row = {
  entry: Entry;
  isBaseline: boolean;
  /** Per-step median, aligned with {@link STEPS}. */
  steps: number[];
  /** Sum of the step medians. */
  total: number;
  /** What the tool itself costs: its total less its own driver's floor. */
  adds: number;
  tail: Tail;
  spread: number;
};

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

/** Run order, one row per entry the run measured. {@link rank} is what orders them for the reader. */
function rows(run: Run): Row[] {
  const stepsOf = (i: number) => STEPS.map((step) => run.results[step][i]);
  const totals = run.entries.map((_, i) => stepsOf(i).reduce((sum, us) => sum + us, 0));
  const floorTotal = (entry: Entry) => {
    const floor = run.entries.indexOf(floorFor(entry));
    if (floor < 0) {
      throw new TypeError(`run has no ${floorFor(entry)} floor to measure ${entry} against`);
    }
    return totals[floor];
  };

  return run.entries.map((entry, i) => ({
    entry,
    isBaseline: isBaseline(entry),
    steps: stepsOf(i),
    total: totals[i],
    adds: totals[i] - floorTotal(entry),
    tail: run.tails[i],
    spread: run.spreads[i],
  }));
}

/** Floors first as the reference, then competitors by what they add. */
export function rank(run: Run): Row[] {
  const all = rows(run);
  return [
    ...all.filter((r) => r.isBaseline).sort((a, b) => a.total - b.total),
    ...all.filter((r) => !r.isBaseline).sort((a, b) => a.adds - b.adds),
  ];
}

/** {@link Row.steps} is aligned with {@link STEPS}; this is the only place that has to know it. */
export const stepOf = (row: Row, step: Step) => row.steps[STEPS.indexOf(step)];

export const competitorsOf = (ranked: Row[]) => ranked.filter((r) => !r.isBaseline);

export function rowFor(ranked: Row[], entry: Entry): Row {
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
