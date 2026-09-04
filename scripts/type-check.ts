/**
 * The type-safety half of the benchmark: the same ten mistakes written in six ORMs' own APIs, and which
 * of them the compiler refuses. `scripts/probes.ts` is the vocabulary, `type-safety/<tool>.ts` the queries.
 *
 * Every probe is compiled twice - as written, and with its correction applied - so a diagnostic only
 * counts when the corrected copy is clean. That control is the whole difference between measuring a
 * tool's types and measuring whether a file happens to be broken.
 *
 * uql-orm.dev has a second harness of the same shape, `scripts/check-type-safety.ts`, and it is not a
 * copy of this one. This compiles the probes against `node_modules`; that one compiles them against the
 * virtual file system Monaco resolves, where a package it cannot reach becomes `any` rather than an
 * error. Only that one can catch a payload gap, and only this one scores. Change the probes and both
 * need re-running.
 *
 * Usage:
 *   bun scripts/type-check.ts
 *   bun scripts/type-check.ts --verify   # fail on a probe that stopped erroring, write nothing
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROBE_FILES, type Verdict, type Verdicts } from './model';
import { COMPILER, PROBE_MARKER, PROBES, type ProbeId } from './probes';
import { flag, installedVersion, root } from './project';
import { printTypeSafetySummary, syncTypeSafetyReport, VERDICTS } from './type-safety-report';

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

  const regions = marked.map(({ from, fix }, i): Region => ({
    id: PROBES[i].id,
    from,
    to: marked[i + 1] ? marked[i + 1].from - 1 : lines.length,
    fix,
  }));

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

const here = (d: Diagnostic) => d.file.includes('/type-safety/') || d.file.startsWith('type-safety/');

const listed = (label: string, diagnostics: Diagnostic[]) =>
  `${label}\n${diagnostics.map((d) => `  ${d.file}:${d.line} ${d.text}`).join('\n')}`;

/** A probe is caught when the mistake errors and the correction does not. */
function verdicts(files: ProbeFile[], probed: Diagnostic[], control: Diagnostic[]): Verdicts {
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

    printTypeSafetySummary(results);

    if (flag('verify')) {
      console.log('\n--verify: every probe checked, nothing written');
      return;
    }

    syncTypeSafetyReport(results);
    console.log(`\nREADME.md type-safety blocks updated, verdicts written to ${VERDICTS}`);
  } finally {
    for (const { stem } of files) {
      rmSync(resolve(DIR, `${stem}.control.ts`), { force: true });
    }
  }
}

main();
