import { defineEntity, f, sql } from 'uql-orm';

export const Company = defineEntity({
  name: 'Company',
  fields: { id: f.number().id(), name: f.string() },
}).relations((rel) => ({
  // Inverse side naming a missing relation | user.compnay -> user.company
  users: () => rel.oneToMany(User, { mappedBy: (user) => user.compnay }),
}));

export const User = defineEntity({
  name: 'User',
  fields: {
    id: f.number().id(),

    // Misspelled option on a column | nulable -> nullable
    nickname: f.string().nulable(),

    // Nullable column declared always present | n/a: the row is derived from the columns, so it cannot disagree with them
    email: f.string().nullable(),

    // Default outside the column's enum | 'archived' -> 'draft'
    status: f.enum(['draft', 'published']).default('archived'),

    // Default of the wrong type | 'zero' -> 0
    createdAt: f.number().default('zero'),

    // Text length on a numeric column | f.number().length(10) -> f.string().length(10)
    code: f.number().length(10),

    // Declared type disagreeing with its column | n/a: the row is derived from the columns, so it cannot disagree with them
    name: f.string(),

    // Optimistic lock on a text column | f.string().version() -> f.version()
    version: f.string().version(),

    // Foreign key of another type than the key it references | companyId: f.string() -> companyId: f.number()
    companyId: f.string(),
  },
})
  .computed((user) => ({
    // Generated column reading a misspelled column | nmae -> name
    shout: f
      .string()
      .as(sql`upper(${user.nmae})`)
      .stored(),
  }))
  // Index on a missing column | emial -> email
  .indexes((user, index) => [index([user.emial])])
  .relations((rel) => ({
    company: () =>
      rel.manyToOne(Company, {
        // Foreign key naming a missing column | user.companyid -> user.companyId
        references: (user) => user.companyid,
      }),
  }));
