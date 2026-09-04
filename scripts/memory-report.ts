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
 * What the run was, including how many samples it threw away: a benchmark that discards data has to say
 * so next to the numbers it kept.
 */
function envLine(run: MemoryRun): string {
  const { machine, when } = machineFacts();
  const worst = Math.max(...run.discarded);
  const worstEntry = run.entries[run.discarded.indexOf(worst)];

  return (
    `> ${run.postgres}, ${run.runtime.label}, ${machine}, ${when}. Median KB allocated per step over ` +
    `${run.iterations} rounds after ${run.warmup} warmup of a ${STEPS.length}-step lifecycle. ` +
    `Samples a garbage collection landed in are discarded, never corrected: at most ` +
    `${(worst * 100).toFixed(0)}% of them (${worstEntry}).`
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
  const most = Math.max(...run.retained);
  const held = run.entries[run.retained.indexOf(most)];
  const grown = most > 0 ? `leave at most ${most}KB behind (${held})` : 'leave every heap smaller than it started';

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

export function syncMemoryReport(run: MemoryRun): void {
  const ranked = rankMemory(run);
  writeReadme({
    'memory-env': envLine(run),
    memory: memoryTable(ranked),
    'memory-note': note(run, ranked),
  });
}
