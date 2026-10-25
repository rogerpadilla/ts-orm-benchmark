import { defineEntity, p } from '@mikro-orm/core';

export const Company = defineEntity({
  name: 'Company',
  properties: {
    id: p.integer().primary(),
    name: p.string(),

    // Inverse side naming a missing relation | 'compnay' -> 'company'
    users: () => p.oneToMany(User).mappedBy('compnay'),
  },
});

export const User = defineEntity({
  name: 'User',
  properties: {
    id: p.integer().primary(),

    // Misspelled option on a column | nulable -> nullable
    name: p.string().nulable(),

    // Nullable column declared always present | n/a: the row is derived from the properties, so it cannot disagree with them
    email: p.string().nullable(),

    // Default outside the column's enum | 'archived' -> 'draft'
    status: p.enum(['draft', 'published']).default('archived'),

    // Default of the wrong type | 'zero' -> 0
    createdAt: p.integer().default('zero'),

    // Text length on a numeric column | p.integer().length(10) -> p.decimal().precision(10)
    score: p.integer().length(10).nullable(),

    // Declared type disagreeing with its column | n/a: the row is derived from the properties, so it cannot disagree with them
    nickname: p.string().nullable(),

    // Optimistic lock on a text column | p.string().version() -> p.integer().version()
    version: p.string().version(),

    // Generated column reading a misspelled column | nmae -> name
    shout: p.string().generated((cols) => `(upper(${cols.nmae})) stored`),

    // Foreign key of another type than the key it references | n/a: the relation owns its column, so no other member declares it

    // Foreign key naming a missing column | n/a: the relation owns its column, so no other member declares it
    company: () => p.manyToOne(Company).nullable(),
  },

  // Index on a missing column | emial -> email
  indexes: [{ properties: ['emial'] }],
});
