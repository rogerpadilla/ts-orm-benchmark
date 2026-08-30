/**
 * What the type-safety check asks of every ORM, and how a probe file says it. The queries themselves are
 * `type-safety/<tool>.ts`, one file per tool, each writing these same ten mistakes in that tool's own API.
 *
 * A probe is a comment and the statement under it:
 *
 *     // Misspelled column in the projection | emial -> email
 *     await uql.findMany(User, { $select: { id: true, emial: true } });
 *
 * The sentence comes first because these files are read as much as they are compiled - on uql-orm.dev
 * they are the page - and what a reader wants from the line above a mistake is what should be caught,
 * not which spelling to swap in. It is `what` from {@link PROBES}, checked against it in order, so the
 * ten are the same ten everywhere and no file can quietly describe its own.
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

/** Probe file stem to the name the timing tables use, so both tables call the same tool the same thing. */
export const PROBE_FILES: Record<string, string> = {
  uql: 'UQL',
  prisma: 'Prisma',
  drizzle: 'Drizzle',
  typeorm: 'TypeORM',
  'mikro-orm': 'MikroORM',
  sequelize: 'Sequelize',
};

/**
 * Checked by the compiler this repo already builds with, and only that one, so a mark is what a reader's
 * own editor would say rather than what some pinned older toolchain would.
 *
 * Worth knowing while reading `select-key`: TypeScript 6.0 stopped reporting excess properties on an
 * object literal checked against a mapped type over an inferred type parameter, and 7 inherits it.
 * Reduced, with no ORM in it:
 *
 *     type Subset<T, U> = { [K in keyof T]: K extends keyof U ? T[K] : never };
 *     declare function findMany<T extends Args>(args: Subset<T, Args>): T;
 *     findMany({ select: { id: true, emial: true } });   // 5.9.3 errors; 6.0.3 and 7.0.2 are silent
 *
 * That is exactly how Prisma (`Subset<T, Args>`) and Drizzle (`KnownKeysOnly<TConfig, DBQueryConfig>`)
 * type a projection, so both lose that check. Counted as missing rather than excused: a check the
 * compiler no longer makes protects nobody, whatever the ORM intended. Pinning 5.9.3 alongside to
 * re-measure this every run was tried and dropped - it is a settled fact about a released compiler
 * rather than something a run can discover, and it cost a second toolchain and a `target` both majors
 * had a name for.
 */
export const COMPILER = { pkg: 'typescript', bin: 'node_modules/typescript/bin/tsc' } as const;
