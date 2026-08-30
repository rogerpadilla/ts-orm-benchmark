/**
 * The type-safety half of the benchmark: the same ten mistakes written in six ORMs' own APIs, and which
 * of them the compiler refuses. `scripts/probes.ts` is the vocabulary, `type-safety/<tool>.ts` the queries.
 *
 * Every probe is compiled twice - as written, and with its correction applied - so a diagnostic only
 * counts when the corrected copy is clean. That control is the whole difference between measuring a
 * tool's types and measuring whether a file happens to be broken.
 *
 * Usage:
 *   bun scripts/type-check.ts
 *   bun scripts/type-check.ts --verify   # fail on a probe that stopped erroring, write nothing
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPILER, PROBE_FILES, PROBE_MARKER, PROBES, type ProbeId } from './probes';
import { flag, installedVersion, root, writeReadme } from './project';
import { linkEntry, mdTable } from './report';

const DIR = resolve(root, 'type-safety');

/** One probe as it sits in a file: the lines it owns, and how to undo the mistake it carries. */
type Region = {
  id: ProbeId;
  /** 1-based, inclusive, marker line included. A diagnostic anywhere in here belongs to this probe. */
  from: number;
  to: number;
  fix: { mistake: string; correction: string };
};

type ProbeFile = { stem: string; entry: string; lines: string[]; regions: Region[] };

function readProbeFile(stem: string): ProbeFile {
  const lines = readFileSync(resolve(DIR, `${stem}.ts`), 'utf8').split('\n');
  const marked = lines.flatMap((line, i) => {
    const match = PROBE_MARKER.exec(line.trim());
    const [, what, mistake, correction] = match ?? [];
    return what && mistake && correction ? [{ what, from: i + 1, fix: { mistake, correction } }] : [];
  });

  // Matched to the catalogue by what each says, in order, which is why a marker carries no id.
  const declared = marked.map(({ what }) => what).join('\n');
  const expected = PROBES.map(({ what }) => what).join('\n');
  if (declared !== expected) {
    throw new TypeError(`${stem}.ts does not mark the ten probes of scripts/probes.ts, in their order`);
  }

  const regions = marked.map(
    ({ from, fix }, i): Region => ({
      id: PROBES[i].id,
      from,
      to: marked[i + 1] ? marked[i + 1].from - 1 : lines.length,
      fix,
    }),
  );

  return { stem, entry: PROBE_FILES[stem], lines, regions };
}

/**
 * The file with every mistake undone, which has to compile clean. The marker line is left out of the
 * replacement scope on purpose: it spells the mistake out, so a scan over the whole region would correct
 * the comment and leave the code alone.
 */
function controlSource({ lines, regions }: ProbeFile): string {
  const out = [...lines];
  for (const { from, to, fix } of regions) {
    const at = out.findIndex((line, i) => i >= from && i < to && line.includes(fix.mistake));
    if (at < 0) {
      throw new TypeError(`probe at line ${from}: '${fix.mistake}' does not appear in the lines below it`);
    }
    out[at] = out[at].replace(fix.mistake, fix.correction);
  }
  return out.join('\n');
}

type Diagnostic = { file: string; line: number; text: string };

/** `path(line,col): error TSxxxx: message`, which both compilers emit with `--pretty false`. */
const DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;

function compile(bin: string, project: string): Diagnostic[] {
  const { stdout, stderr } = spawnSync(process.execPath, [resolve(root, bin), '-p', project, '--pretty', 'false'], {
    cwd: root,
    encoding: 'utf8',
  });
  return `${stdout}${stderr}`.split('\n').flatMap((line) => {
    const match = DIAGNOSTIC.exec(line);
    return match
      ? [{ file: match[1].replaceAll('\\', '/'), line: Number(match[2]), text: `${match[3]}: ${match[4]}` }]
      : [];
  });
}

type Verdict = 'caught' | 'missed';

const here = (d: Diagnostic) => d.file.includes('/type-safety/') || d.file.startsWith('type-safety/');

const listed = (label: string, diagnostics: Diagnostic[]) =>
  `${label}\n${diagnostics.map((d) => `  ${d.file}:${d.line} ${d.text}`).join('\n')}`;

/** A probe is caught when the mistake errors and the correction does not. */
function verdicts(files: ProbeFile[], probed: Diagnostic[], control: Diagnostic[]): Map<string, Verdict[]> {
  const broken = control.filter(here);
  if (broken.length) {
    throw new Error(listed('the corrected probes must compile clean, and these did not:', broken));
  }

  // A diagnostic outside every probe region is the context itself failing - `clients.ts` no longer
  // describing the real clients, most likely. Nothing below would look at it, and the run would report a
  // set of verdicts drawn from a file that does not compile.
  const inRegion = (d: Diagnostic) =>
    files.some(
      ({ stem, regions }) =>
        d.file.endsWith(`type-safety/${stem}.ts`) &&
        regions.some((region) => d.line >= region.from && d.line <= region.to),
    );
  const stray = probed.filter((d) => here(d) && !inRegion(d));
  if (stray.length) {
    throw new Error(listed('every error has to belong to a probe, and these belong to nothing:', stray));
  }

  return new Map(
    files.map(({ stem, entry, regions }) => [
      entry,
      regions.map((region): Verdict => {
        const hit = probed.some(
          (d) => d.file.endsWith(`type-safety/${stem}.ts`) && d.line >= region.from && d.line <= region.to,
        );
        return hit ? 'caught' : 'missed';
      }),
    ]),
  );
}

const MARK: Record<Verdict, string> = { caught: '✅', missed: '❌' };

const score = (vs: Verdict[]) => vs.filter((v) => v === 'caught').length;

/**
 * Best first, so the column order is the ranking and the table needs no separate one. Ties break
 * alphabetically rather than by declaration order: four entries tie at the top today, and putting the
 * one we wrote first would be the benchmark flattering its author.
 */
const ranked = (results: Map<string, Verdict[]>) =>
  [...results].sort((a, b) => score(b[1]) - score(a[1]) || a[0].localeCompare(b[0]));

function table(results: Map<string, Verdict[]>): string {
  const order = ranked(results);
  const best = Math.max(...order.map(([, vs]) => score(vs)));

  return mdTable(
    ['Mistake', ...order.map(([entry]) => linkEntry(entry))],
    [
      ...PROBES.map((probe, i) => [probe.what, ...order.map(([, vs]) => MARK[vs[i]])]),
      [
        `**Caught**, of ${PROBES.length}`,
        ...order.map(([, vs]) => (score(vs) === best ? `**${score(vs)}** 🥇` : `${score(vs)}`)),
      ],
    ],
  );
}

/**
 * The two things worth saying about the table, both computed: how far apart the field is, and which
 * mistake nobody catches, since a probe every tool misses is the one a reader should worry about.
 */
function note(results: Map<string, Verdict[]>): string {
  const order = ranked(results);
  const best = score(order[0][1]);
  // Named as a group, because the top of this table ties far more readily than the timing one does:
  // ten probes cannot separate six tools the way a microsecond can.
  const leaders = order.filter(([, vs]) => score(vs) === best).map(([entry]) => entry);
  const last = order[order.length - 1];
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

const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

const VERDICTS = 'type-safety/verdicts.json';

/**
 * The same verdicts the README table is drawn from, in a shape another program can read. Written because
 * uql-orm.dev loads these probe files into a live editor and has to label them with something: parsing
 * the marks back out of a markdown table, or recounting them from a compile of its own, would be a second
 * scoreboard that could disagree with this one. The control compile happens here and only here.
 *
 * Alphabetical, not ranked. This is data rather than a table, and a consumer that walks it in order gets
 * a list that does not rearrange itself every time a score moves - which is worth more than encoding the
 * ranking twice, since each verdict carries its own. `table()` sorts for itself.
 */
function writeVerdicts(results: Map<string, Verdict[]>) {
  writeFileSync(
    resolve(root, VERDICTS),
    `${JSON.stringify(
      {
        typescript: installedVersion(COMPILER.pkg),
        probes: PROBES,
        entries: Object.fromEntries([...results].sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2,
    )}\n`,
  );
}

function main() {
  // Driven by the catalogue rather than by whatever is in the directory: a probe file nobody named is a
  // file nobody scores, and `readProbeFile` says which one is missing better than a directory scan could.
  const files = Object.keys(PROBE_FILES).map(readProbeFile);
  for (const file of files) {
    writeFileSync(resolve(DIR, `${file.stem}.control.ts`), controlSource(file));
  }

  try {
    console.log(`checking with TypeScript ${installedVersion(COMPILER.pkg)}\n`);
    const results = verdicts(
      files,
      compile(COMPILER.bin, 'type-safety/tsconfig.json'),
      compile(COMPILER.bin, 'type-safety/tsconfig.control.json'),
    );

    for (const [entry, vs] of ranked(results)) {
      console.log(`${entry.padEnd(10)} ${String(score(vs)).padStart(2)}/${PROBES.length}`);
    }

    if (flag('verify')) {
      console.log('\n--verify: every probe checked, nothing written');
      return;
    }

    writeReadme({
      'type-safety': table(results),
      'type-safety-note': note(results),
      'type-safety-env': `> Checked with TypeScript ${installedVersion(COMPILER.pkg)}, ${PROBES.length} probes per entry.`,
    });
    writeVerdicts(results);
    console.log(`\nREADME.md type-safety blocks updated, verdicts written to ${VERDICTS}`);
  } finally {
    for (const { stem } of files) {
      rmSync(resolve(DIR, `${stem}.control.ts`), { force: true });
    }
  }
}

main();
