/**
 * The rename-safety half of the benchmark: each tool's model renamed with that tool's own rename, and what
 * became of every place that named what was renamed. `scripts/renames.ts` is the vocabulary,
 * `rename-safety/` the code.
 *
 * The TypeScript files are renamed through `tsc --lsp`, the server an editor runs; Prisma's schema through
 * `prisma-language-server`, its editor extension's. That one also adds `@map` to keep the old column, and
 * that edit is dropped: the rename measured here takes the column with the field, as every other entry's does.
 *
 * A mention left behind is compiled on a copy of its file where every other one is written as renamed, so
 * an error is charged only to the probe that caused it: `defineEntity`, for one, reports a stale property
 * as a single error on the whole call. The copy with all of them written as renamed has to compile clean,
 * and so do the originals, so a flagged probe is the rename's doing and nothing else's.
 *
 * The two excerpts uql-orm.dev's playground shows, `rename-safety/playground/`, are renamed and scored the same
 * way, and each has to carry its full file's code for every mention and reach the same verdict on it.
 *
 * Usage:
 *   bun scripts/rename-check.ts
 *   bun scripts/rename-check.ts --verify   # score and print, write nothing
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyEdits, type LanguageServer, startLanguageServer, type TextEdit } from './lsp';
import { PROBE_FILES } from './model';
import { flag, installedVersion, root } from './project';
import { printRenameSummary, type RenameResults, syncRenameReport } from './rename-safety-report';
import {
  assertEveryProbe,
  PLAYGROUND,
  PLAYGROUND_RENAMES,
  RENAME_PROBES,
  type RenameMention,
  type RenamePlayground,
  type RenameRegion,
  renameRegions,
  RENAMES,
} from './renames';

const DIR = resolve(root, 'rename-safety');
const RENAMED = resolve(DIR, 'renamed');
const SCHEMA = 'prisma/schema.prisma';

/**
 * One tool's files, relative to `rename-safety/`: the TypeScript file, beside it Prisma's schema, and TypeORM's in
 * a project of its own, since its decorators need `experimentalDecorators` and UQL's are the standard ones.
 */
const FILES: Partial<Record<string, string[]>> = { prisma: ['prisma.ts', SCHEMA], typeorm: ['typeorm/typeorm.ts'] };
const filesOf = (stem: string) => FILES[stem] ?? [`${stem}.ts`];

/** The directory under `rename-safety/` whose `tsconfig.json` compiles a TypeScript file, as an editor finds it. */
const projectOf = (file: string) => (existsSync(resolve(DIR, dirname(file), 'tsconfig.json')) ? dirname(file) : '.');

/** Where a file's renamed copies go under `renamed/`, in its project: `playground/uql.ts` is `playground-uql`. */
const copyOf = (file: string) =>
  join(projectOf(file), relative(projectOf(file), file).replace(/\.ts$/, '').replaceAll('/', '-'));

type Diagnostic = { file: string; line: number; text: string };

const listed = (diagnostics: Diagnostic[]) => diagnostics.map((d) => `  ${d.file}:${d.line} ${d.text}`).join('\n');

/** `path(line,col): error TSxxxx: message`, with `--pretty false`. */
const TS_DIAGNOSTIC = /^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/;

function compile(project: string): Diagnostic[] {
  const { stdout, stderr } = spawnSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', project, '--pretty', 'false'], {
    cwd: root,
    encoding: 'utf8',
  });
  return `${stdout}${stderr}`.split('\n').flatMap((line) => {
    const match = TS_DIAGNOSTIC.exec(line);
    return match ? [{ file: resolve(root, match[1]), line: Number(match[2]), text: match[3] }] : [];
  });
}

/** Validates a schema, and generates its client when it is valid; each error by the line it points at. */
function prisma(schema: string): Diagnostic[] {
  const run = (command: string) =>
    spawnSync(resolve(root, 'node_modules/.bin/prisma'), [command, '--schema', schema], {
      cwd: root,
      encoding: 'utf8',
    });
  const validated = run('validate');
  const output = `${validated.stdout}${validated.stderr}`;
  const errors = [...output.matchAll(/^error: (.+)\n\s*-->\s+.*?:(\d+)/gm)].map((match) => ({
    file: schema,
    line: Number(match[2]),
    text: match[1],
  }));
  if (validated.status !== 0 && !errors.length) {
    throw new Error(`prisma validate failed without naming a line:\n${output}`);
  }
  if (!errors.length) {
    const generated = run('generate');
    if (generated.status !== 0) {
      throw new Error(`prisma generate failed:\n${generated.stdout}${generated.stderr}`);
    }
  }
  return errors;
}

type Position = TextEdit['range']['start'];
type Rename = (typeof RENAMES)[number];

const positionOf = (text: string, offset: number): Position => {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before[before.length - 1].length };
};

const offsetOf = (text: string, { line, character }: Position) =>
  text
    .split('\n')
    .slice(0, line)
    .reduce((sum, current) => sum + current.length + 1, 0) + character;

/** A rename edit, and the member whose rename made it. */
type MemberEdit = { member: string; range: TextEdit['range'] };

const renamedTo = (member: string) => RENAMES.find(({ from }) => from === member)?.to ?? member;

/**
 * Each member renamed from where the server will start: its first mention outside a comment and a string that
 * the server agrees to rename, since starting inside a string could rename matching literals and leave the
 * member alone. Every rename is asked of the original text, so every edit is in the file's own coordinates,
 * which is what uql-orm.dev marks them by; different members never share an edit, so all of them apply at once.
 */
async function renameEdits(
  server: LanguageServer,
  path: string,
  languageId: string,
  renames: readonly Rename[],
  keep = (_: string) => true,
): Promise<MemberEdit[]> {
  const uri = pathToFileURL(path).href;
  const text = readFileSync(path, 'utf8');
  server.open(uri, languageId, text);

  const edits: MemberEdit[] = [];
  for (const { from, to } of renames) {
    for (const match of text.matchAll(new RegExp(`\\b${from}\\b`, 'g'))) {
      const before = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
      if (before.trimStart().startsWith('//') || /['"`]$/.test(before)) {
        continue;
      }
      const found = await server.rename(uri, positionOf(text, match.index), to);
      if (!found.length) {
        continue;
      }
      for (const { range, newText } of found.filter((edit) => keep(edit.newText))) {
        const replaced = text.slice(offsetOf(text, range.start), offsetOf(text, range.end));
        if (replaced !== from || newText !== to) {
          throw new Error(
            `${path}: renaming '${from}' turned '${replaced}' into '${newText}', which is not that rename`,
          );
        }
        edits.push({ member: from, range });
      }
      break;
    }
  }
  return edits;
}

/** Every file's rename edits, by its path under `rename-safety/`, each made by its own tool. */
async function renameEverything(stems: string[]): Promise<Map<string, MemberEdit[]>> {
  const edits = new Map<string, MemberEdit[]>();

  const ts = await startLanguageServer(
    resolve(root, 'node_modules/.bin/tsc'),
    ['--lsp', '--stdio'],
    pathToFileURL(root).href,
  );
  try {
    for (const stem of stems) {
      // Prisma's queries declare nothing a TypeScript rename could start from: its schema does.
      const renames = stem === 'prisma' ? [] : RENAMES;
      for (const file of filesOf(stem).filter((path) => path.endsWith('.ts'))) {
        edits.set(file, await renameEdits(ts, resolve(DIR, file), 'typescript', renames));
      }
    }
    for (const file of Object.values(PLAYGROUND)) {
      edits.set(file, await renameEdits(ts, resolve(DIR, file), 'typescript', PLAYGROUND_RENAMES));
    }
  } finally {
    ts.close();
  }

  const schema = await startLanguageServer(
    resolve(root, 'node_modules/.bin/prisma-language-server'),
    ['--stdio'],
    pathToFileURL(DIR).href,
  );
  try {
    const keep = (newText: string) => !newText.trimStart().startsWith('@map(');
    edits.set(SCHEMA, await renameEdits(schema, resolve(DIR, SCHEMA), 'prisma', RENAMES, keep));
  } finally {
    schema.close();
  }

  return edits;
}

const OLD_NAMES = RENAMES.map(({ from }) => from).join('|');

/** The regions that still name something the rename was meant to reach. */
const leftIn = (text: string, regions: readonly RenameRegion[]) => {
  const lines = text.split('\n');
  const stale = new RegExp(`\\b(${OLD_NAMES})\\b`);
  return regions.filter(
    (region) => !region.na && lines.slice(region.from, region.to + 1).some((line) => stale.test(line)),
  );
};

/** `text` with the mentions in `regions` written as renamed, as if the rename had reached them. */
function settle(text: string, regions: readonly RenameRegion[]): string {
  const lines = text.split('\n');
  const stale = new RegExp(`\\b(${OLD_NAMES})\\b`, 'g');
  for (const { from, to } of regions) {
    for (let i = from; i <= to; i++) {
      lines[i] = lines[i].replace(stale, renamedTo);
    }
  }
  return lines.join('\n');
}

/** A region's code with its common indent removed, and each rename edit inside it by offset in that code. */
function snippetOf(text: string, region: RenameRegion, edits: readonly MemberEdit[]) {
  if (region.na) {
    return { snippet: '', edits: [] };
  }
  const lines = text.split('\n').slice(region.from, region.to + 1);
  const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
  const startOf = (line: number) =>
    lines.slice(0, line - region.from).reduce((sum, current) => sum + current.length - indent + 1, 0);
  const at = ({ line, character }: Position) => startOf(line) + character - indent;
  return {
    snippet: lines.map((line) => line.slice(indent)).join('\n'),
    edits: edits
      .filter(({ range }) => range.start.line >= region.from && range.end.line <= region.to)
      .map(({ member, range }) => ({ member, start: at(range.start), end: at(range.end) })),
  };
}

const flat = (code: string) => code.replace(/\s+/g, ' ').trim();

async function main() {
  const stems = Object.keys(PROBE_FILES);
  const files = [...stems.flatMap(filesOf), ...Object.values(PLAYGROUND)];
  const typescriptFiles = files.filter((file) => file.endsWith('.ts'));
  const projects = [...new Set(typescriptFiles.map(projectOf))];
  const originals = new Map(files.map((file) => [file, readFileSync(resolve(DIR, file), 'utf8')] as const));
  const regionsOf = (file: string) => renameRegions(originals.get(file) ?? '', file);
  const regions = new Map(stems.map((stem) => [stem, filesOf(stem).flatMap(regionsOf)]));
  for (const [stem, found] of regions) {
    assertEveryProbe(found, stem);
  }

  const broken = [
    ...prisma(resolve(DIR, SCHEMA)),
    ...projects.flatMap((project) => compile(join('rename-safety', project, 'tsconfig.json'))),
  ];
  if (broken.length) {
    throw new Error(`the originals must compile clean, and these did not:\n${listed(broken)}`);
  }

  const edits = await renameEverything(stems);
  const renamed = new Map(
    [...originals].map(([file, text]) => [
      file,
      applyEdits(
        text,
        (edits.get(file) ?? []).map(({ member, range }) => ({ range, newText: renamedTo(member) })),
      ),
    ]),
  );

  rmSync(RENAMED, { recursive: true, force: true });
  mkdirSync(resolve(RENAMED, 'prisma'), { recursive: true });
  for (const project of projects) {
    const dir = resolve(RENAMED, project);
    mkdirSync(dir, { recursive: true });
    const extended = relative(dir, resolve(DIR, project, 'tsconfig.json'));
    writeFileSync(resolve(dir, 'tsconfig.json'), `${JSON.stringify({ extends: extended, include: ['*.ts'] })}\n`);
  }

  // Prisma's validator scores what the rename left in its schema; the queries compile against a client
  // generated as if the rename had reached all of it, so they are scored on their own mentions.
  const schemaPath = resolve(RENAMED, SCHEMA);
  const schemaText = renamed.get(SCHEMA) ?? '';
  writeFileSync(schemaPath, schemaText);
  const schemaErrors = prisma(schemaPath);
  writeFileSync(schemaPath, settle(schemaText, leftIn(schemaText, regionsOf(SCHEMA))));
  const settledSchema = prisma(schemaPath);
  if (settledSchema.length) {
    throw new Error(`the schema written as fully renamed must validate, and did not:\n${listed(settledSchema)}`);
  }

  for (const file of typescriptFiles) {
    const text = renamed.get(file) ?? '';
    const left = leftIn(text, regionsOf(file));
    writeFileSync(resolve(RENAMED, `${copyOf(file)}.settled.ts`), settle(text, left));
    for (const region of left) {
      const others = left.filter((other) => other !== region);
      writeFileSync(resolve(RENAMED, `${copyOf(file)}.${region.id}.ts`), settle(text, others));
    }
  }

  const diagnostics = projects.flatMap((project) => compile(join('rename-safety/renamed', project, 'tsconfig.json')));
  const errorsIn = (name: string) => diagnostics.filter((d) => d.file === resolve(RENAMED, name));

  const unsettled = typescriptFiles.flatMap((file) => errorsIn(`${copyOf(file)}.settled.ts`));
  if (unsettled.length) {
    throw new Error(`each file written as fully renamed must compile clean, and these did not:\n${listed(unsettled)}`);
  }

  const mentionOf = (region: RenameRegion): RenameMention => {
    const shown = {
      file: region.file,
      startLine: region.from + 1,
      endLine: region.to + 1,
      ...snippetOf(originals.get(region.file) ?? '', region, edits.get(region.file) ?? []),
      reason: region.na ?? null,
    };
    if (region.na) {
      return { verdict: 'n/a', ...shown, message: null };
    }
    if (!leftIn(renamed.get(region.file) ?? '', [region]).length) {
      return { verdict: 'followed', ...shown, message: null };
    }
    const refusal =
      region.file === SCHEMA
        ? schemaErrors.find((d) => d.line >= region.from + 1 && d.line <= region.to + 1)
        : errorsIn(`${copyOf(region.file)}.${region.id}.ts`)[0];
    return refusal
      ? { verdict: 'flagged', ...shown, message: refusal.text }
      : { verdict: 'silent', ...shown, message: null };
  };

  const results: RenameResults = new Map(
    stems.map((stem) => [
      PROBE_FILES[stem],
      RENAME_PROBES.map(({ id }) => {
        const region = (regions.get(stem) ?? []).find((candidate) => candidate.id === id);
        if (!region) {
          throw new TypeError(`${stem} marks no '${id}'`);
        }
        return mentionOf(region);
      }),
    ]),
  );

  const playground: RenamePlayground = {
    renames: PLAYGROUND_RENAMES,
    entries: Object.fromEntries(
      Object.entries(PLAYGROUND).map(([entry, file]) => {
        const scored = results.get(entry) ?? [];
        const mentions = regionsOf(file).map((region) => {
          const excerpt = mentionOf(region);
          const whole = scored[RENAME_PROBES.findIndex(({ id }) => id === region.id)];
          if (!whole || !flat(excerpt.snippet).includes(flat(whole.snippet))) {
            throw new Error(`${file}: '${region.id}' is not the code ${entry}'s own file scores`);
          }
          if (excerpt.verdict !== whole.verdict) {
            throw new Error(
              `${file}: '${region.id}' is ${excerpt.verdict} here and ${whole.verdict} in ${entry}'s file`,
            );
          }
          return excerpt;
        });
        return [entry, { file, source: originals.get(file) ?? '', mentions }];
      }),
    ),
  };

  console.log(
    `renamed with TypeScript ${installedVersion('typescript')} and prisma-language-server ` +
      `${installedVersion('@prisma/language-server')}\n`,
  );
  printRenameSummary(results);

  if (flag('verify')) {
    console.log('\n--verify: every probe checked, nothing written');
    return;
  }
  syncRenameReport(results, playground);
}

await main();
