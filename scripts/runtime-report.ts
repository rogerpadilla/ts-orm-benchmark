/**
 * Renders the cross-runtime blocks of README.md from one {@link Run} per runtime. Percentiles rather than
 * medians alone: what a runtime comparison is asked about is the tail, and a median is where it hides.
 */

import { RUNTIME_LABELS } from '../src/runtime';
import { competitorsOf, type Entry, percentileIndex, type Row, type Run, rank, type Tail } from './model';
import { writeReadme } from './project';
import { envFacts, linkEntry, mdTable } from './report';

/** A median and a p99 tell the whole story: one is the common case, the other is the worst you ship. */
const PERCENTILES = ['p50', 'p99'] as const;

type Percentile = (typeof PERCENTILES)[number];

/** One runtime's run with its rows addressable by entry, which is how every line here reads a figure. */
type Measured = { run: Run; byEntry: Map<Entry, Row> };

const measure = (run: Run): Measured => ({ run, byEntry: new Map(rank(run).map((row) => [row.entry, row])) });

/** Full label for the caption, bare name in the prose under it: the versions are stated once. */
const label = (m: Measured) => m.run.runtime.label;
const name = (m: Measured) => RUNTIME_LABELS[m.run.runtime.name];

function tail(m: Measured, entry: Entry): Tail {
  const row = m.byEntry.get(entry);
  if (!row) {
    throw new TypeError(`${label(m)} did not measure ${entry}`);
  }
  return row.tail;
}

/** Row order for the table: the first run's ranking, which is why the caller passes Bun first. */
const entriesOf = (measured: Measured[]): Entry[] => rank(measured[0].run).map((row) => row.entry);

/**
 * A runtime that measured fewer entries carried less work per round, and its tail would read better for
 * that reason alone. The comparison is refused rather than footnoted.
 */
function assertSameEntries(measured: Measured[]): void {
  const [reference, ...rest] = measured;
  for (const m of rest) {
    const same =
      m.run.entries.length === reference.run.entries.length &&
      m.run.entries.every((entry) => reference.byEntry.has(entry));
    if (!same) {
      throw new TypeError(`${label(m)} measured a different set of entries than ${label(reference)}`);
    }
  }
}

/**
 * Rows are entries, columns are runtime x percentile: the layout that answers both questions at once,
 * whether the runtime moves the number and whether it moves the tail more than the median.
 */
function runtimeTable(measured: Measured[]): string {
  const header = measured.flatMap((m) => PERCENTILES.map((p) => `${RUNTIME_LABELS[m.run.runtime.name]} ${p}`));

  const rows = entriesOf(measured).map((entry) => {
    const best = PERCENTILES.map((p) => Math.min(...measured.map((m) => tail(m, entry)[p])));
    const cells = measured.flatMap((m) =>
      PERCENTILES.map((p, i) => {
        const us = tail(m, entry)[p];
        return us === best[i] ? `**${us}**` : `${us}`;
      }),
    );
    return [linkEntry(entry), ...cells];
  });

  return mdTable(['Entry (µs)', ...header], rows);
}

function envLine(measured: Measured[]): string {
  const { run } = measured[0];
  const { postgres, machine, when } = envFacts(run);
  // A p99 of 250 rounds is the third slowest round, which is noise; saying what the figure is drawn from is
  // the difference between a tail number and an anecdote.
  const slowest = run.iterations - percentileIndex(run.iterations, 99);

  return (
    `> ${measured.map(label).join(', ')}, all running the same bundled JavaScript, one at a time against ` +
    `the same database. ${postgres}, ${machine}, ${when}. µs for a whole lifecycle, nearest-rank ` +
    `percentiles over ${run.iterations} rounds after ${run.warmup} warmup, so a p99 is drawn from the ` +
    `${slowest} slowest rounds.`
  );
}

/** The floor is the one entry that is the same code everywhere, so it is where the runtime alone shows. */
function floorSentence(measured: Measured[]): string {
  const floors = measured.map((m) => ({ label: name(m), tail: tail(m, 'raw pg') }));
  const fastest = (p: Percentile) => floors.reduce((a, b) => (b.tail[p] < a.tail[p] ? b : a)).label;
  const spread = (p: Percentile) => {
    const values = floors.map((f) => f.tail[p]);
    return Math.max(...values) - Math.min(...values);
  };
  const inflation = floors.map((f) => `${Math.round((f.tail.p99 / f.tail.p50 - 1) * 100)}% on ${f.label}`).join(', ');

  // One runtime often leads both, and "Bun leads the median, Bun the tail" reads like a typo.
  const lead =
    fastest('p50') === fastest('p99')
      ? `${fastest('p50')} leads both`
      : `${fastest('p50')} leads the median, ${fastest('p99')} the tail`;

  return (
    `On \`raw pg\`, the same code on all of them, the runtimes are ${spread('p50')}µs apart at p50 but ` +
    `${spread('p99')}µs apart at p99: ${lead}, and each p99 is ${inflation} above its own p50.`
  );
}

/** Puts the runtime gap next to the ORM gap, which is the only way to say which of the two to spend on. */
function scaleSentence(measured: Measured[]): string {
  const widest = entriesOf(measured)
    .map((entry) => {
      const p50s = measured.map((m) => tail(m, entry).p50);
      return { entry, gap: Math.max(...p50s) - Math.min(...p50s) };
    })
    .reduce((a, b) => (b.gap > a.gap ? b : a));

  const ormGaps = measured.map((m) => {
    const competitors = competitorsOf(rank(m.run));
    return competitors[competitors.length - 1].adds - competitors[0].adds;
  });

  const decides = widest.gap > Math.min(...ormGaps) ? 'runtime' : 'ORM';

  return (
    `Switching runtime moves any single entry by at most ${widest.gap}µs at p50 (${widest.entry}), where ` +
    `switching ORM on one runtime moves it ${Math.min(...ormGaps)}-${Math.max(...ormGaps)}µs, so the ` +
    `${decides} is the bigger decision here.`
  );
}

/**
 * Whether the runtime reorders the ORMs, which is the reason to publish three runs instead of one. Naming
 * the pairs that actually swap, rather than printing every order in full: one pair usually moves.
 */
function orderSentence(measured: Measured[]): string {
  const entries = competitorsOf(rank(measured[0].run)).map((r) => r.entry);
  const adds = measured.map((m) => new Map(competitorsOf(rank(m.run)).map((r) => [r.entry, r.adds])));
  const addsFor = (i: number, entry: Entry) => adds[i].get(entry) ?? 0;

  const swaps = entries.flatMap((a, i) =>
    entries.slice(i + 1).flatMap((b) => {
      const order = new Set(measured.map((_, r) => Math.sign(addsFor(r, a) - addsFor(r, b))));
      const gap = Math.min(...measured.map((_, r) => Math.abs(addsFor(r, a) - addsFor(r, b))));
      return order.size > 1 ? [{ pair: `${a} and ${b}`, gap }] : [];
    }),
  );

  if (swaps.length === 0) {
    return `Ranked by what each ORM adds, every runtime agrees: ${entries.join(' < ')}.`;
  }

  const closest = swaps.reduce((a, b) => (b.gap < a.gap ? b : a));
  return swaps.length === 1
    ? `The one pair that changes places between runtimes is ${closest.pair}, ${closest.gap}µs apart.`
    : `${swaps.length} pairs change places between runtimes, the closest ${closest.pair} at ${closest.gap}µs.`;
}

export function syncRuntimeReport(runs: Run[]): void {
  const measured = runs.map(measure);
  assertSameEntries(measured);
  writeReadme({
    'runtime-env': envLine(measured),
    runtimes: runtimeTable(measured),
    'runtime-note': [floorSentence(measured), scaleSentence(measured), orderSentence(measured)].join(' '),
  });
}
