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
 * Usage:
 *   bun scripts/rename-check.ts
 *   bun scripts/rename-check.ts --verify   # score and print, write nothing
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPILER, compile, type Diagnostic, listed } from './compiler';
import { applyEdits, type LanguageServer, offsetAt, positionAt, startLanguageServer, type TextEdit } from './lsp';
import { PROBE_FILES } from './model';
import { flag, root } from './project';
import {
  printRenameSummary,
  renameTooling,
  type RenameResults,
  syncRenameReport,
  VERDICTS,
} from './rename-safety-report';
import { byProbe, type RenameMention, type RenameRegion, renameRegions, RENAMES } from './renames';

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

/** Where a file's renamed copies go under `renamed/`: in its own project, named after it. */
const copyOf = (file: string) => join(projectOf(file), basename(file, '.ts'));

/** Validates a schema, and generates its client when it is valid; each error by the line it points at. */
function validateSchema(schema: string): Diagnostic[] {
  const prisma = (command: string) => {
    const { status, stdout, stderr } = spawnSync(
      resolve(root, 'node_modules/.bin/prisma'),
      [command, '--schema', schema],
      { cwd: root, encoding: 'utf8' },
    );
    return { status, output: `${stdout}${stderr}` };
  };
  const validated = prisma('validate');
  const errors = [...validated.output.matchAll(/^error: (.+)\n\s*-->\s+.*?:(\d+)/gm)].map((match) => ({
    file: schema,
    line: Number(match[2]),
    text: match[1],
  }));
  if (validated.status !== 0 && !errors.length) {
    throw new Error(`prisma validate failed without naming a line:\n${validated.output}`);
  }
  if (errors.length) {
    return errors;
  }
  const generated = prisma('generate');
  if (generated.status !== 0) {
    throw new Error(`prisma generate failed:\n${generated.output}`);
  }
  return [];
}

/**
 * Each member renamed from where the server will start: its first mention outside a comment and a string that
 * the server agrees to rename, since starting inside a string could rename matching literals and leave the
 * member alone. Every rename is asked of the original text, so every edit is in the file's own coordinates,
 * and different members never share an edit, so all of them apply at once.
 */
async function renameEdits(
  server: LanguageServer,
  file: string,
  keep: (edit: TextEdit) => boolean,
): Promise<TextEdit[]> {
  const uri = pathToFileURL(resolve(DIR, file)).href;
  const text = readFileSync(resolve(DIR, file), 'utf8');
  server.open(uri, file.endsWith('.prisma') ? 'prisma' : 'typescript', text);

  const edits: TextEdit[] = [];
  for (const { from, to } of RENAMES) {
    for (const match of text.matchAll(new RegExp(`\\b${from}\\b`, 'g'))) {
      const before = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
      if (before.trimStart().startsWith('//') || /['"`]$/.test(before)) {
        continue;
      }
      const found = await server.rename(uri, positionAt(text, match.index), to);
      if (!found.length) {
        continue;
      }
      for (const edit of found.filter(keep)) {
        const replaced = text.slice(offsetAt(text, edit.range.start), offsetAt(text, edit.range.end));
        if (replaced !== from || edit.newText !== to) {
          throw new Error(`${file}: renaming '${from}' turned '${replaced}' into '${edit.newText}'`);
        }
        edits.push(edit);
      }
      break;
    }
  }
  return edits;
}

/** Every file's rename edits, by its path under `rename-safety/`, each made by its own tool. */
async function renameEverything(toolFiles: readonly string[]): Promise<Map<string, TextEdit[]>> {
  const edits = new Map<string, TextEdit[]>();

  const ts = await startLanguageServer(process.execPath, [COMPILER.bin, '--lsp', '--stdio'], pathToFileURL(root).href);
  try {
    // Prisma's queries declare nothing a TypeScript rename could start from: its schema does.
    for (const file of toolFiles.filter((file) => file.endsWith('.ts') && file !== 'prisma.ts')) {
      edits.set(file, await renameEdits(ts, file, () => true));
    }
  } finally {
    ts.close();
  }

  const prisma = await startLanguageServer(
    resolve(root, 'node_modules/.bin/prisma-language-server'),
    ['--stdio'],
    pathToFileURL(DIR).href,
  );
  try {
    const takesColumn = ({ newText }: TextEdit) => !newText.trimStart().startsWith('@map(');
    edits.set(SCHEMA, await renameEdits(prisma, SCHEMA, takesColumn));
  } finally {
    prisma.close();
  }

  return edits;
}

const STALE = new RegExp(`\\b(${RENAMES.map(({ from }) => from).join('|')})\\b`, 'g');
const renamedTo = (member: string) => RENAMES.find(({ from }) => from === member)?.to ?? member;

/** `text` with the mentions in `regions` written as renamed, as if the rename had reached them. */
function settle(text: string, regions: readonly RenameRegion[]): string {
  const lines = text.split('\n');
  for (const { from, to } of regions) {
    for (let i = from; i <= to; i++) {
      lines[i] = lines[i].replace(STALE, renamedTo);
    }
  }
  return lines.join('\n');
}

/** Whether `region` of `text` still names something the rename was meant to reach. */
const isLeft = (text: string, region: RenameRegion) => settle(text, [region]) !== text;

async function main() {
  const stems = Object.keys(PROBE_FILES);
  const files = stems.flatMap(filesOf);
  const typescriptFiles = files.filter((file) => file.endsWith('.ts'));
  const projects = [...new Set(typescriptFiles.map(projectOf))];
  const originals = new Map(files.map((file) => [file, readFileSync(resolve(DIR, file), 'utf8')]));
  const regionsOf = (file: string) => renameRegions(originals.get(file) ?? '', file);
  const tools = stems.map((stem) => ({ stem, regions: byProbe(filesOf(stem).flatMap(regionsOf), stem) }));

  const broken = [
    ...validateSchema(resolve(DIR, SCHEMA)),
    ...projects.flatMap((project) => compile(join('rename-safety', project, 'tsconfig.json'))),
  ];
  if (broken.length) {
    throw new Error(listed('the originals must compile clean, and these did not:', broken));
  }

  const edits = await renameEverything(files);
  const renamed = new Map([...originals].map(([file, text]) => [file, applyEdits(text, edits.get(file) ?? [])]));
  const leftIn = (file: string) => regionsOf(file).filter((region) => isLeft(renamed.get(file) ?? '', region));

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
  writeFileSync(schemaPath, renamed.get(SCHEMA) ?? '');
  const schemaErrors = validateSchema(schemaPath);
  writeFileSync(schemaPath, settle(renamed.get(SCHEMA) ?? '', leftIn(SCHEMA)));
  const settledSchema = validateSchema(schemaPath);
  if (settledSchema.length) {
    throw new Error(listed('the schema written as fully renamed must validate, and did not:', settledSchema));
  }

  for (const file of typescriptFiles) {
    const text = renamed.get(file) ?? '';
    const left = leftIn(file);
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
    throw new Error(listed('each file written as fully renamed must compile clean, and these did not:', unsettled));
  }

  const verdictOf = (region: RenameRegion): Pick<RenameMention, 'verdict' | 'message'> => {
    if (region.na) {
      return { verdict: 'n/a', message: null };
    }
    if (!isLeft(renamed.get(region.file) ?? '', region)) {
      return { verdict: 'followed', message: null };
    }
    const refusal =
      region.file === SCHEMA
        ? schemaErrors.find((d) => d.line >= region.from + 1 && d.line <= region.to + 1)
        : errorsIn(`${copyOf(region.file)}.${region.id}.ts`)[0];
    return refusal ? { verdict: 'flagged', message: refusal.text } : { verdict: 'silent', message: null };
  };

  const mentionOf = (region: RenameRegion): RenameMention => ({
    ...verdictOf(region),
    file: region.file,
    startLine: region.from + 1,
    endLine: region.to + 1,
  });

  const results: RenameResults = new Map(tools.map(({ stem, regions }) => [PROBE_FILES[stem], regions.map(mentionOf)]));

  const { typescript, prismaLanguageServer } = renameTooling();
  console.log(`renamed with TypeScript ${typescript} and prisma-language-server ${prismaLanguageServer}\n`);
  printRenameSummary(results);

  if (flag('verify')) {
    console.log('\n--verify: every probe checked, nothing written');
    return;
  }
  syncRenameReport(results);
  console.log(`\nREADME.md rename-safety blocks updated, results written to ${VERDICTS}`);
}

await main();
