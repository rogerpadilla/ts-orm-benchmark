/**
 * The mistakes `type-safety/<tool>.ts` writes in each tool's API, marked `// <what> | <mistake> -> <correction>`.
 * A marker owns the code under it, up to the next marker; `what` is checked against {@link PROBES} in order.
 */

/** `// <what> | <mistake> -> <correction>`, which is how a probe file marks one out. */
export const PROBE_MARKER = /^\/\/ (.+?) \| (.+?) -> (.+)$/;

export const PROBES = [
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
] as const;

export type ProbeId = (typeof PROBES)[number]['id'];

/**
 * The correction every file writes identically, for the probes whose mistake is the same name in every
 * API, so no entry can quietly probe an easier column. The operator probe is left out: each ORM spells
 * its operators its own way.
 */
export const SHARED_FIXES: Partial<Record<ProbeId, string>> = {
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
};
