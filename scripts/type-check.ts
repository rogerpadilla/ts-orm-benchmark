/**
 * Compiles each probe in a copy of its file where it is the only mistake left, and counts it caught when that copy
 * errors. One mistake per copy, so no mistake is credited with another's error. The suites are in `scripts/probes.ts`.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPILER, compile, type Diagnostic, instantiations, listed, validateSchema } from './compiler';
import type { Costs, Verdict, Verdicts } from './model';
import { DEFINITIONS, type Probe, PROBE_MARKER, probePath, QUERIES, type Suite } from './probes';
import { flag, installedVersion, root } from './project';
import { printTypeSafetySummary, syncTypeSafetyReport } from './type-safety-report';

/** One probe as it sits in a file: its marker line, and how to undo the mistake under it, or why it has none. */
type Marked = { probe: Probe; marker: number; fix?: { mistake: string; correction: string }; na?: string };

type ProbeFile = { stem: string; entry: string; ext: 'ts' | 'prisma'; lines: string[]; marked: Marked[] };

function readProbeFile(suite: Suite, stem: string): ProbeFile {
  const path = probePath(suite, stem);
  const ext = path.endsWith('.ts') ? 'ts' : 'prisma';
  const lines = readFileSync(resolve(root, path), 'utf8').split('\n');
  const found = lines.flatMap((line, marker) => {
    const [, what, na, mistake, correction] = PROBE_MARKER.exec(line.trim()) ?? [];
    const probe = suite.probes.find((candidate) => candidate.what === what);
    return probe ? [{ probe, marker, na, fix: mistake ? { mistake, correction } : undefined }] : [];
  });

  // In the catalogue's order, which is the table's, so a reader finds each where they expect it.
  const marked = suite.probes.map((probe) => {
    const of = found.filter((m) => m.probe === probe);
    if (of.length !== 1) {
      throw new TypeError(`${path} has to mark '${probe.what}' once, and marks it ${of.length} times`);
    }
    return of[0];
  });

  for (const { probe, fix } of marked) {
    const shared = suite.fixes[probe.id];
    const written = fix && `${fix.mistake} -> ${fix.correction}`;
    if (shared && fix && written !== shared) {
      throw new TypeError(`${path} corrects '${probe.id}' as '${written}', where every file writes '${shared}'`);
    }
  }

  return { stem, entry: suite.stems[stem], ext, lines, marked };
}

/**
 * The file with every mistake but `kept` corrected. A mistake is corrected on the first line below its marker that
 * holds it, never on the marker, which spells it out, and never past the next marker.
 */
function sourceKeeping({ lines, marked }: ProbeFile, kept?: Probe): string {
  const out = [...lines];
  const markers = marked.map(({ marker }) => marker).sort((a, b) => a - b);
  for (const { probe, marker, fix } of marked) {
    if (!fix || probe === kept) {
      continue;
    }
    const next = markers.find((line) => line > marker) ?? out.length;
    const at = out.findIndex((line, i) => i > marker && i < next && line.includes(fix.mistake));
    if (at < 0) {
      throw new TypeError(`'${probe.what}': '${fix.mistake}' does not appear between its marker and the next`);
    }
    out[at] = out[at].replace(fix.mistake, fix.correction);
  }
  return out.join('\n');
}

/** Generated beside the originals, so their relative imports resolve, and removed when the run ends. */
const copyName = ({ stem, ext }: ProbeFile, probe?: Probe) => `${stem}.${probe?.id ?? 'control'}.probe.${ext}`;

function check(suite: Suite): { verdicts: Verdicts; costs?: Costs } {
  const dir = resolve(root, suite.dir);
  const files = Object.keys(suite.stems).map((stem) => readProbeFile(suite, stem));
  const copies = files.flatMap((file) => [
    { file, probe: undefined, name: copyName(file) },
    ...file.marked.filter(({ fix }) => fix).map(({ probe }) => ({ file, probe, name: copyName(file, probe) })),
  ]);

  try {
    for (const { file, probe, name } of copies) {
      writeFileSync(resolve(dir, name), sourceKeeping(file, probe));
    }

    const typescript = compile(`${suite.dir}/tsconfig.probes.json`);
    const errorsIn = (name: string): Diagnostic[] =>
      name.endsWith('.prisma')
        ? validateSchema(resolve(dir, name), { generate: false })
        : typescript.filter((d) => d.file === resolve(dir, name));

    // An error in no copy is the context itself failing: `clients.ts` no longer describing the real clients,
    // most likely, which would score every probe importing it.
    const names = new Set(copies.map(({ name }) => resolve(dir, name)));
    const broken = [
      ...typescript.filter((d) => !names.has(d.file)),
      ...files.flatMap((file) => errorsIn(copyName(file))),
    ];
    if (broken.length) {
      throw new Error(listed('the corrected probes and their context must compile clean, and these did not:', broken));
    }

    const verdicts: Verdicts = new Map(
      files.map((file) => [
        file.entry,
        file.marked.map(({ probe, na }): Verdict => {
          if (na) {
            return 'n/a';
          }
          return errorsIn(copyName(file, probe)).length ? 'caught' : 'missed';
        }),
      ]),
    );
    return { verdicts, costs: suite.weighed ? weigh(dir, files) : undefined };
  } finally {
    for (const { name } of copies) {
      rmSync(resolve(dir, name), { force: true });
    }
  }
}

/** The copy holding only a file's imports, which is compiled to weigh what the library costs. */
const importsName = ({ stem }: ProbeFile) => `${stem}.imports.probe.ts`;

/**
 * Each TypeScript model's own type cost: its corrected copy, less a file holding only its imports, so what is left
 * is what checking the definitions costs rather than loading the library's declarations.
 */
function weigh(dir: string, files: ProbeFile[]): Costs {
  const typescript = files.filter(({ ext }) => ext === 'ts');
  try {
    return new Map(
      typescript.map((file) => {
        const imports = sourceKeeping(file).match(/^import[\s\S]*?;$/gm) ?? [];
        writeFileSync(resolve(dir, importsName(file)), `${imports.join('\n')}\n`);
        return [file.entry, instantiations(dir, copyName(file)) - instantiations(dir, importsName(file))];
      }),
    );
  } finally {
    for (const file of typescript) {
      rmSync(resolve(dir, importsName(file)), { force: true });
    }
  }
}

function main() {
  console.log(`checking with TypeScript ${installedVersion(COMPILER.pkg)}`);
  const results = [QUERIES, DEFINITIONS].map((suite) => ({ suite, ...check(suite) }));

  for (const { suite, verdicts, costs } of results) {
    console.log(`\n${suite.dir}`);
    printTypeSafetySummary(verdicts, costs);
  }

  if (flag('verify')) {
    console.log('\n--verify: every probe checked, nothing written');
    return;
  }

  for (const { suite, verdicts, costs } of results) {
    syncTypeSafetyReport(suite, verdicts, costs);
  }
  console.log('\nREADME.md type-safety blocks updated, verdicts written beside each suite');
}

main();
