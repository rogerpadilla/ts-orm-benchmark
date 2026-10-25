/**
 * Renders a suite's README blocks and the verdicts another program reads, from one set of {@link Verdicts}.
 * Measuring is `scripts/type-check.ts`; this only says what it found.
 */

import { resolve } from 'node:path';
import { COMPILER } from './compiler';
import type { Costs, Verdict, Verdicts } from './model';
import { probePath, type Suite } from './probes';
import { installedVersion, root, writeJson, writeReadme } from './project';
import { alphabetical, bold, linkEntry, list, mdTable } from './render';

const MARK: Record<Verdict, string> = { caught: '✅', missed: '❌', 'n/a': '-' };

const count = (vs: Verdict[], verdict: Verdict) => vs.filter((v) => v === verdict).length;
const applicable = (vs: Verdict[]) => vs.length - count(vs, 'n/a');

function table(suite: Suite, results: Verdicts, costs?: Costs): string {
  const order = alphabetical(results);
  const fewest = Math.min(...order.map(([, vs]) => count(vs, 'missed')));

  return mdTable(
    ['Mistake', ...order.map(([entry]) => linkEntry(entry))],
    [
      ...suite.probes.map((probe, i) => [probe.what, ...order.map(([, vs]) => MARK[vs[i]])]),
      [
        '**Caught**',
        ...order.map(([, vs]) => bold(`${count(vs, 'caught')} of ${applicable(vs)}`, count(vs, 'missed') === fewest)),
      ],
      ...(costs ? [costRow(order, costs)] : []),
    ],
  );
}

/** Lowest in bold, like every table's leading cell; `-` for a model that is not TypeScript. */
function costRow(order: [string, Verdict[]][], costs: Costs): string[] {
  const lowest = Math.min(...costs.values());
  const cell = (entry: string) => {
    const cost = costs.get(entry);
    return cost === undefined ? '-' : bold(cost.toLocaleString('en-US'), cost === lowest);
  };
  return ['**Instantiations** to check the model', ...order.map(([entry]) => cell(entry))];
}

/**
 * The two things worth saying about the table, both computed: how far apart the field is, and which mistake
 * nobody catches, since a probe every tool misses is the one a reader should worry about. Ranked by what each
 * misses, so an entry whose API cannot express a mistake is neither credited nor blamed for it.
 */
function note(suite: Suite, results: Verdicts): string {
  const order = alphabetical(results);
  const missed = order.map(([, vs]) => count(vs, 'missed'));
  const fewest = Math.min(...missed);
  // Named as a group, because the top of this table ties far more readily than the timing one does:
  // a handful of probes cannot separate tools the way a microsecond can.
  const leaders = order.filter(([, vs]) => count(vs, 'missed') === fewest).map(([entry]) => entry);
  const [last, lastVerdicts] = order[missed.indexOf(Math.max(...missed))];
  const missedByAll = suite.probes.filter((_, i) => order.every(([, vs]) => vs[i] !== 'caught'));
  const universal = missedByAll.length
    ? ` No entry catches ${missedByAll.length === 1 ? 'one of them' : `${missedByAll.length} of them`}: ` +
      `${missedByAll.map((p) => p.what.toLowerCase()).join(', ')}.`
    : ' Every mistake here is caught by at least one entry.';

  return (
    `${list(leaders)} ${leaders.length > 1 ? 'each miss' : 'misses'} ${fewest === 0 ? 'none' : fewest}; ${last} misses ` +
    `${count(lastVerdicts, 'missed')} of the ${applicable(lastVerdicts)} its API can express.${universal} The ` +
    'copy with every mistake corrected compiles clean, so a red mark is a missing check, never a broken file.'
  );
}

/** The compiler, and Prisma's validator where a suite's Prisma file is a schema rather than TypeScript. */

export function printTypeSafetySummary(results: Verdicts, costs?: Costs): void {
  for (const [entry, vs] of alphabetical(results)) {
    const cost = costs?.get(entry);
    const weighed = cost === undefined ? '' : `  ${String(cost).padStart(7)} instantiations`;
    console.log(`${entry.padEnd(17)} ${String(count(vs, 'caught')).padStart(2)}/${applicable(vs)}${weighed}`);
  }
}

/**
 * Writes the README blocks and `<suite>/verdicts.json`, which uql-orm.dev loads into a live editor: parsing the
 * marks back out of a markdown table would be a second scoreboard that could disagree with this one.
 */
const checkerNames = (suite: Suite) =>
  Object.keys(suite.stems).some((stem) => probePath(suite, stem).endsWith('.prisma'))
    ? `TypeScript ${installedVersion(COMPILER.pkg)} and \`prisma validate\` ${installedVersion('prisma')}`
    : `TypeScript ${installedVersion(COMPILER.pkg)}`;

export function syncTypeSafetyReport(suite: Suite, results: Verdicts, costs?: Costs): void {
  writeReadme({
    [suite.dir]: table(suite, results, costs),
    [`${suite.dir}-note`]: note(suite, results),
    [`${suite.dir}-env`]: `> Checked with ${checkerNames(suite)}, ${suite.probes.length} probes per entry.`,
  });
  const order = alphabetical(results);
  const stemByEntry = Object.fromEntries(Object.entries(suite.stems).map(([stem, entry]) => [entry, stem]));
  const stems = Object.fromEntries(order.map(([entry]) => [entry, stemByEntry[entry]]));
  writeJson(resolve(root, suite.dir, 'verdicts.json'), {
    typescript: installedVersion(COMPILER.pkg),
    probes: suite.probes,
    stems,
    files: [...Object.values(stems).map((stem) => probePath(suite, stem)), ...suite.context],
    entries: Object.fromEntries(order),
    ...(costs && { instantiations: Object.fromEntries(costs) }),
  });
}
