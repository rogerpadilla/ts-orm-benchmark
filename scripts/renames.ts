/**
 * What the rename-safety check asks of every ORM, and how a file marks it. The code is
 * `rename-safety/<tool>.ts`, one self-contained file per tool: its model and every place that names a
 * renamed member, written the most rename-friendly way that tool's API allows. TypeORM's is
 * `rename-safety/typeorm/typeorm.ts`, a project of its own for the legacy decorators that way needs.
 *
 * A rename here is a field and the column it maps to, the way each tool maps one by default, done with
 * that tool's own rename: the TypeScript language server, or Prisma's for its schema. A probe is a
 * comment and the code under it, up to the next marker, a blank line, or a line indented less than the
 * marker:
 *
 *     // Field in the filter
 *     await pool.findMany(User, { $where: { emailAddress: 'ada@example.com' } });
 *
 * `// <what> | n/a: <why>` marks a probe the tool has no way to declare, and owns no code.
 */

import { regionEnd } from './markers';

export const RENAMES = [
  { from: 'emailAddress', to: 'email', kind: 'field' },
  { from: 'employerId', to: 'workplaceId', kind: 'foreign key' },
  { from: 'employer', to: 'workplace', kind: 'relation' },
] as const;

export const RENAME_GROUPS = {
  definition: 'Definitions',
  sql: 'SQL in definitions',
  query: 'Queries',
  raw: 'Raw SQL in a query',
} as const;

export const RENAME_PROBES = [
  { id: 'index', group: 'definition', what: 'Index on the field' },
  { id: 'unique', group: 'definition', what: 'Composite unique index' },
  { id: 'include', group: 'definition', what: 'Covering index column' },
  { id: 'foreign-key', group: 'definition', what: 'Foreign key of a relation' },
  { id: 'inverse', group: 'definition', what: 'Inverse side of a relation' },
  { id: 'expression-index', group: 'sql', what: 'Expression index' },
  { id: 'partial-index', group: 'sql', what: 'Partial index condition' },
  { id: 'check', group: 'sql', what: 'Check constraint' },
  { id: 'generated', group: 'sql', what: 'Generated column' },
  { id: 'select', group: 'query', what: 'Field in the projection' },
  { id: 'filter', group: 'query', what: 'Field in the filter' },
  { id: 'sort', group: 'query', what: 'Field in the sort' },
  { id: 'nested-select', group: 'query', what: 'Field inside a loaded relation' },
  { id: 'relation', group: 'query', what: 'Relation loaded by name' },
  { id: 'insert', group: 'query', what: 'Field in inserted data' },
  { id: 'update', group: 'query', what: 'Field in updated data' },
  { id: 'group', group: 'query', what: 'Foreign key in a grouped count' },
  { id: 'result', group: 'query', what: 'Field read off the result' },
  { id: 'raw-filter', group: 'raw', what: 'Raw SQL in a filter' },
] as const satisfies readonly { id: string; group: keyof typeof RENAME_GROUPS; what: string }[];

export type RenameProbeId = (typeof RENAME_PROBES)[number]['id'];

/**
 * `followed`: the rename edited every mention. `flagged`: one was left, and the renamed code fails to
 * compile there. `silent`: one was left and it compiles, so it breaks at run time or in a migration.
 */
export type RenameVerdict = 'followed' | 'flagged' | 'silent' | 'n/a';

/** One probe as one entry scored it, with what uql-orm.dev needs to show it without compiling anything. */
export type RenameMention = {
  verdict: RenameVerdict;
  /** The file under `rename-safety/`, and the 1-based lines of the code under the marker. */
  file: string;
  startLine: number;
  endLine: number;
  /** Those lines with their common indent removed, and where in them each member's rename edited. */
  snippet: string;
  edits: { member: string; start: number; end: number }[];
  /** The compiler's first error, for a flagged mention. */
  message: string | null;
  /** Why the entry cannot declare it, for a probe that does not apply. */
  reason: string | null;
};

/** The two excerpts uql-orm.dev's rename playground shows, by the entry each is cut from. */
export const PLAYGROUND = { UQL: 'playground/uql.ts', Drizzle: 'playground/drizzle.ts' } as const;

/** The one rename the playground plays. */
export const PLAYGROUND_RENAMES = RENAMES.filter(({ kind }) => kind === 'field');

export type RenamePlayground = {
  renames: readonly (typeof RENAMES)[number][];
  entries: Record<string, { file: string; source: string; mentions: RenameMention[] }>;
};

/** A line comment naming a probe, with the reason it does not apply when it does not. */
const MARKER = /^\s*\/\/ (.+?)(?: \| n\/a: (.+))?$/;

export type RenameRegion = {
  id: RenameProbeId;
  /** The file the marker is in, as the caller named it. */
  file: string;
  /** 0-based line of the marker. */
  marker: number;
  /** 0-based, inclusive; empty (`to < from`) for a probe that does not apply. */
  from: number;
  to: number;
  na?: string;
};

/** The probes marked in one file, in whatever order the file needs them. */
export function renameRegions(source: string, file: string): RenameRegion[] {
  const lines = source.split('\n');
  const markers = lines.flatMap((line, i) => {
    const [, what, na] = MARKER.exec(line) ?? [];
    const probe = RENAME_PROBES.find((candidate) => candidate.what === what);
    return probe ? [{ id: probe.id, marker: i, na }] : [];
  });

  const isMarker = new Set(markers.map(({ marker }) => marker));
  return markers.map(({ id, marker, na }): RenameRegion => {
    if (na) {
      return { id, file, marker, from: marker + 1, to: marker, na };
    }
    const to = regionEnd(lines, marker, (line) => isMarker.has(line));
    if (to === marker) {
      throw new TypeError(`${file}:${marker + 1}: '${lines[marker].trim()}' marks no code`);
    }
    return { id, file, marker, from: marker + 1, to };
  });
}

/** Throws unless `regions`, gathered from every file of one tool, mark each probe exactly once. */
export function assertEveryProbe(regions: readonly RenameRegion[], tool: string): void {
  const wrong = RENAME_PROBES.filter(({ id }) => regions.filter((region) => region.id === id).length !== 1);
  if (wrong.length) {
    throw new TypeError(`${tool} has to mark each probe once, and does not: ${wrong.map((p) => p.what).join(', ')}`);
  }
}
