/**
 * Renders the memory blocks of README.md from one {@link MemoryRun}. Same floors and the same `adds`
 * framing `scripts/report.ts` uses, so a reader who has understood the timing tables has understood this
 * one: both answer what a tool costs above hand-written driver code, in the unit each was measured in.
 */

import { competitorsOf, type MemoryRun, PUBLISHED_STEPS, type Row, rankMemory, STEPS, stepOf } from './model';
import { writeReadme } from './project';
import { bold, linkEntry, machineFacts, mdTable } from './render';

/** Rows are entries here, not steps: seven entries read better down the page than across it. */
function memoryTable(ranked: Row[]): string {
  const best = Math.min(...competitorsOf(ranked).map((r) => r.adds));

  const rows = ranked.map((r) => [
    r.isBaseline ? `_${linkEntry(r.entry)}_` : linkEntry(r.entry),
    ...PUBLISHED_STEPS.map((step) => `${stepOf(r, step)}`),
    `${r.total}`,
    r.isBaseline ? 'floor' : bold(`+${r.adds}`, r.adds === best),
  ]);

  return mdTable(['Entry', ...PUBLISHED_STEPS, 'Total KB', 'Adds KB'], rows);
}

/**
 * What the run was, including how many samples it threw away. A benchmark that discards data has to say
 * so, and it has to say so per entry: the rule drops the rounds a collection ran in, and a collection is
 * likelier the more an entry allocates, so a heavy entry and a light one are only measured the same way
 * while both rates stay near zero. {@link driftedEstimator} is what refuses the run when they do not.
 */
/** The highest of a per-entry figure and whose it is, which both captions below need. */
function peak(run: MemoryRun, values: number[]) {
  const most = Math.max(...values);
  return { most, entry: run.entries[values.indexOf(most)] };
}

function envLine(run: MemoryRun): string {
  const { machine, when } = machineFacts();
  const worst = peak(run, run.discarded);

  return (
    `> ${run.postgres}, ${run.runtime.label}, ${machine}, ${when}. Median KB allocated per step over ` +
    `${run.iterations} rounds after ${run.warmup} warmup of a ${STEPS.length}-step lifecycle. Rounds a ` +
    `garbage collection ran in are discarded, never corrected, and no entry lost more than ` +
    `${(worst.most * 100).toFixed(0)}% of its own (${worst.entry}).`
  );
}

/**
 * Why this table is worth a section of its own, in the two facts a reader would otherwise have to derive:
 * how far the field spans, and which step opens it.
 */
function note(run: MemoryRun, ranked: Row[]): string {
  const competitors = competitorsOf(ranked);
  const lowest = competitors[0];
  const highest = competitors[competitors.length - 1];

  const widest = PUBLISHED_STEPS.map((step) => {
    const values = competitors.map((r) => stepOf(r, step));
    return { step, ratio: Math.max(...values) / Math.min(...values) };
  }).reduce((a, b) => (b.ratio > a.ratio ? b : a));

  const worst = competitors.reduce((a, b) => (stepOf(b, widest.step) > stepOf(a, widest.step) ? b : a));
  const best = competitors.reduce((a, b) => (stepOf(b, widest.step) < stepOf(a, widest.step) ? b : a));

  // Every entry usually ends at or below where it started, so this figure is normally negative. Reported
  // as it fell rather than clamped to zero, since which way it went is the finding.
  const kept = peak(run, run.retained);
  const grown =
    kept.most > 0 ? `leave at most ${kept.most}KB behind (${kept.entry})` : 'leave every heap smaller than it started';

  return (
    `Above the floor the field spans ${(highest.adds / lowest.adds).toFixed(1)}x: ${lowest.adds}KB for ` +
    `${lowest.entry}, ${highest.adds}KB for ${highest.entry}, and ${widest.step} opens it widest: ` +
    `${worst.entry}'s ${stepOf(worst, widest.step)}KB against ${best.entry}'s ` +
    `${stepOf(best, widest.step)}KB.\n\n` +
    `Almost none of it survives: another ${run.iterations} lifecycles, collected either side, ${grown}, ` +
    `identity maps included. What the table prices is collector pressure, not a resident set that grows.`
  );
}

export function printMemorySummary(run: MemoryRun): void {
  const retained = new Map(run.entries.map((entry, i) => [entry, run.retained[i]]));
  for (const r of rankMemory(run)) {
    const cost = r.isBaseline ? 'floor' : `+${r.adds}KB`;
    const held = `${retained.get(r.entry)}KB held`;
    console.log(`${r.entry.padEnd(12)} ${`${r.total}KB`.padStart(8)} ${cost.padEnd(9)} ${held}`);
  }
}

/**
 * The share of its own rounds an entry may lose to a collection and still be measured like the others.
 * Discarding those rounds is the only way to read an allocation off `heapUsed`, but a collection is
 * likelier the more an entry allocates: past some rate a heavy entry's median comes from its quietest
 * rounds while a light one's comes from nearly all of them, and the table is comparing two things.
 * At 10% every entry still keeps nine rounds in ten. Today the worst is 2%.
 */
const MAX_DISCARDED = 0.1;

function assertComparable(run: MemoryRun): void {
  const strained = run.entries.flatMap((entry, i) =>
    run.discarded[i] > MAX_DISCARDED ? [`${entry} ${(run.discarded[i] * 100).toFixed(0)}%`] : [],
  );
  if (strained.length) {
    throw new Error(
      `${strained.join(', ')}: lost more than ${MAX_DISCARDED * 100}% of their rounds to a collection, ` +
        'so their medians come from their quietest rounds and are not comparable with the rest. ' +
        'More iterations will not help; the entry allocates enough to disturb its own measurement.',
    );
  }
}

export function syncMemoryReport(run: MemoryRun): void {
  // Only the publishing path: a `--verify` run measures three rounds, where the rate means nothing.
  assertComparable(run);
  const ranked = rankMemory(run);
  writeReadme({
    'memory-env': envLine(run),
    memory: memoryTable(ranked),
    'memory-note': note(run, ranked),
  });
}
