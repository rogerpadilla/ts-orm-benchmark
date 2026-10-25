/**
 * Each tool's probe files mark a mistake `// <what> | <mistake> -> <correction>`, or `// <what> | n/a: <why>` where
 * its API cannot express one. Queries live in `type-safety/`, entity definitions in `definition-safety/`.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROBE_FILES } from './model';
import { root } from './project';

export const PROBE_MARKER = /^\/\/ (.+?) \| (?:n\/a: (.+)|(.+?) -> (.+))$/;

export type Probe = { readonly id: string; readonly what: string };

const QUERY_PROBES: readonly Probe[] = [
  { id: 'select-key', what: 'Misspelled column in the projection' },
  { id: 'where-key', what: 'Misspelled column in the filter' },
  { id: 'where-value', what: 'String value against a numeric column' },
  { id: 'where-operator', what: 'Text operator against a numeric column' },
  { id: 'sort-key', what: 'Misspelled column in the sort' },
  { id: 'sum-column', what: 'Sum over a text column' },
  { id: 'nested-select-key', what: 'Misspelled column inside a loaded relation' },
  { id: 'insert-key', what: 'Misspelled column in inserted data' },
  { id: 'insert-required', what: 'Required column left out of inserted data' },
  { id: 'update-value', what: 'Number written into a text column' },
  { id: 'result-unselected', what: 'Reading a column the projection left out' },
  { id: 'result-nested', what: 'Reading a misspelled column off a loaded relation' },
];

const DEFINITION_PROBES: readonly Probe[] = [
  { id: 'option-key', what: 'Misspelled option on a column' },
  { id: 'option-type', what: 'Text length on a numeric column' },
  { id: 'default-type', what: 'Default of the wrong type' },
  { id: 'default-enum', what: "Default outside the column's enum" },
  { id: 'declared-type', what: 'Declared type disagreeing with its column' },
  { id: 'declared-null', what: 'Nullable column declared always present' },
  { id: 'version-type', what: 'Optimistic lock on a text column' },
  { id: 'generated-key', what: 'Generated column reading a misspelled column' },
  { id: 'foreign-key', what: 'Foreign key naming a missing column' },
  { id: 'foreign-key-type', what: 'Foreign key of another type than the key it references' },
  { id: 'inverse', what: 'Inverse side naming a missing relation' },
  { id: 'index-key', what: 'Index on a missing column' },
];

/**
 * One set of mistakes and the files that write them. `fixes` is the correction every file writes identically,
 * for the probes whose mistake is the same name in every API, so no entry can quietly probe an easier column.
 */
export type Suite = {
  readonly dir: string;
  readonly probes: readonly Probe[];
  readonly fixes: Readonly<Partial<Record<string, string>>>;
  /** Probe file stem to the entry its table names. */
  readonly stems: Readonly<Record<string, string>>;
  /** What the probes compile against besides themselves, which a reader needs to compile them too. */
  readonly context: readonly string[];
  /** Whether each model's type cost is measured: only where a file declares its model and imports nothing shared. */
  readonly weighed?: true;
};

export const QUERIES: Suite = {
  dir: 'type-safety',
  probes: QUERY_PROBES,
  // The operator probe is left out: each ORM spells its operators its own way.
  fixes: {
    'select-key': 'emial -> email',
    'where-key': 'createdat -> createdAt',
    'where-value': "'one' -> 1",
    'sort-key': 'idd -> id',
    'sum-column': 'name -> id',
    'nested-select-key': 'nmae -> name',
    'insert-key': 'emails -> email',
    'insert-required': "'New User' } -> 'New User', email: 'new@example.com' }",
    'update-value': "42 -> 'Updated Name'",
    'result-unselected': 'user.email -> user.name',
    'result-nested': '.nmae -> .name',
  },
  stems: PROBE_FILES,
  context: ['type-safety/clients.ts', 'src/schema.ts', 'prisma/schema.prisma'],
};

/** UQL twice, since it declares an entity two ways: decorators on a class, and a schema its row is derived from. */
export const DEFINITIONS: Suite = {
  dir: 'definition-safety',
  probes: DEFINITION_PROBES,
  fixes: {
    'generated-key': 'nmae -> name',
    'index-key': 'emial -> email',
  },
  stems: { ...PROBE_FILES, uql: 'UQL (decorators)', 'uql-schema': 'UQL (schema)' },
  context: [],
  weighed: true,
};

/** A probe file, relative to the root: `<stem>.ts`, or `<stem>.prisma` for a schema Prisma's validator checks. */
export const probePath = (suite: Suite, stem: string) =>
  existsSync(resolve(root, suite.dir, `${stem}.ts`)) ? `${suite.dir}/${stem}.ts` : `${suite.dir}/${stem}.prisma`;
