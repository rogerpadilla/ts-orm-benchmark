/**
 * What the type-safety check asks of every ORM, and how a probe file says it. The queries themselves are
 * `type-safety/<tool>.ts`, one file per tool, each writing these same ten mistakes in that tool's own API.
 *
 * A probe is a comment and the statement under it:
 *
 *     // Misspelled column in the projection | emial -> email
 *     await uql.findMany(User, { $select: { id: true, emial: true } });
 *
 * The sentence comes first because these files are read as much as compiled - on uql-orm.dev they are
 * the page - and a reader wants to know what should be caught, not which spelling to swap in. It is
 * `what` from {@link PROBES}, checked in order, so no file describes its own probes.
 *
 * The region runs to the next marker. `emial -> email` is the correction, and it is what makes the result
 * mean anything: `scripts/type-check.ts` compiles the file twice, once as written and once with every
 * correction applied. A probe counts as caught when the mistake produces a diagnostic in its region *and*
 * the corrected copy produces none, so a tool cannot score by being broken in some unrelated way.
 */

/** `// <what> | <mistake> -> <correction>`, which is how a probe file marks one out. */
export const PROBE_MARKER = /^\/\/ (.+?) \| (.+?) -> (.+)$/;

export const PROBES = [
  { id: 'select-key', what: 'Misspelled column in the projection' },
  { id: 'where-key', what: 'Misspelled column in the filter' },
  { id: 'where-value', what: 'String value against a numeric column' },
  { id: 'where-operator', what: 'Text operator against a numeric column' },
  { id: 'sort-key', what: 'Misspelled column in the sort' },
  { id: 'nested-select-key', what: 'Misspelled column inside a loaded relation' },
  { id: 'insert-key', what: 'Misspelled column in inserted data' },
  { id: 'update-value', what: 'Number written into a text column' },
  { id: 'result-unselected', what: 'Reading a column the projection left out' },
  { id: 'result-nested', what: 'Reading a misspelled column off a loaded relation' },
] as const;

export type ProbeId = (typeof PROBES)[number]['id'];

/**
 * Checked by the compiler this repo already builds with, and only that one, so a mark is what a reader's
 * own editor would say rather than what some pinned older toolchain would. Why `select-key` is red for
 * Prisma and Drizzle on TypeScript 6 and up is the type-safety section of README.md; pinning 5.9.3
 * alongside to re-measure it every run was tried and dropped, since it is a settled fact about a
 * released compiler rather than something a run can discover.
 */
export const COMPILER = { pkg: 'typescript', bin: 'node_modules/typescript/bin/tsc' } as const;
