/**
 * Renders the type-safety blocks of README.md, and the verdicts another program reads, from one set of
 * {@link Verdicts}. The compiling and scoring is `scripts/type-check.ts`, the same split the other three
 * benchmarks have: measuring is one file, saying what it found is another.
 */

import { resolve } from 'node:path';
import { COMPILER } from './compiler';
import { stemsOf, type Verdict, type Verdicts } from './model';
import { PROBES } from './probes';
import { installedVersion, root, writeJson, writeReadme } from './project';
import { alphabetical, bold, linkEntry, list, mdTable } from './render';

const MARK: Record<Verdict, string> = { caught: '✅', missed: '❌' };

export const score = (vs: Verdict[]) => vs.filter((v) => v === 'caught').length;

function table(results: Verdicts): string {
  const order = alphabetical(results);
  const best = Math.max(...order.map(([, vs]) => score(vs)));

  return mdTable(
    ['Mistake', ...order.map(([entry]) => linkEntry(entry))],
    [
      ...PROBES.map((probe, i) => [probe.what, ...order.map(([, vs]) => MARK[vs[i]])]),
      [`**Caught**, of ${PROBES.length}`, ...order.map(([, vs]) => bold(score(vs), score(vs) === best))],
    ],
  );
}

/**
 * The two things worth saying about the table, both computed: how far apart the field is, and which
 * mistake nobody catches, since a probe every tool misses is the one a reader should worry about.
 */
function note(results: Verdicts): string {
  const order = alphabetical(results);
  const scores = order.map(([, vs]) => score(vs));
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  // Named as a group, because the top of this table ties far more readily than the timing one does:
  // a handful of probes cannot separate tools the way a microsecond can.
  const leaders = order.filter(([, vs]) => score(vs) === best).map(([entry]) => entry);
  const last = order.find(([, vs]) => score(vs) === worst) ?? order[order.length - 1];
  const missedByAll = PROBES.filter((_, i) => order.every(([, vs]) => vs[i] === 'missed'));
  const universal = missedByAll.length
    ? ` No entry catches ${missedByAll.length === 1 ? 'one of them' : `${missedByAll.length} of them`}: ` +
      `${missedByAll.map((p) => p.what.toLowerCase()).join(', ')}.`
    : ' Every mistake here is caught by at least one entry.';

  return (
    `${list(leaders)} ${leaders.length > 1 ? 'each catch' : 'catches'} ${best} of the ${PROBES.length}, ` +
    `${last[0]} ${score(last[1])}.${universal} The corrected copy of every file compiles clean, which is ` +
    `what makes a red mark a missing check rather than a broken query.`
  );
}

export const VERDICTS = 'type-safety/verdicts.json';

/** What the probes compile against besides themselves: their clients, the schema those are typed by, and Prisma's. */
const CONTEXT = ['type-safety/clients.ts', 'src/schema.ts', 'prisma/schema.prisma'];

export function printTypeSafetySummary(results: Verdicts): void {
  for (const [entry, vs] of alphabetical(results)) {
    console.log(`${entry.padEnd(10)} ${String(score(vs)).padStart(2)}/${PROBES.length}`);
  }
}

/**
 * The README blocks and, in {@link VERDICTS}, the same verdicts in a shape another program can read, with every
 * file it takes to compile them. uql-orm.dev loads these files into a live editor; parsing the marks back out of a
 * markdown table would be a second scoreboard that could disagree with this one.
 */
export function syncTypeSafetyReport(results: Verdicts): void {
  writeReadme({
    'type-safety': table(results),
    'type-safety-note': note(results),
    'type-safety-env': `> Checked with TypeScript ${installedVersion(COMPILER.pkg)}, ${PROBES.length} probes per entry.`,
  });
  const order = alphabetical(results);
  const stems = stemsOf(order.map(([entry]) => entry));
  writeJson(resolve(root, VERDICTS), {
    typescript: installedVersion(COMPILER.pkg),
    probes: PROBES,
    stems,
    files: [...Object.values(stems).map((stem) => `type-safety/${stem}.ts`), ...CONTEXT],
    entries: Object.fromEntries(order),
  });
}
