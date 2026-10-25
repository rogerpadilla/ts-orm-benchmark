import { relations, type SQL, sql } from 'drizzle-orm';
import { index, integer, numeric, pgEnum, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const companies = pgTable('Company', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

const status = pgEnum('status', ['draft', 'published']);

export const users = pgTable(
  'User',
  {
    id: serial('id').primaryKey(),

    // Misspelled option on a column | notNul -> notNull
    name: text('name').notNul(),

    // Nullable column declared always present | n/a: the row is derived from the columns, so it cannot disagree with them
    email: text('email'),

    // Default outside the column's enum | 'archived' -> 'draft'
    status: status('status').default('archived'),

    // Default of the wrong type | 'zero' -> 0
    createdAt: integer('createdAt').default('zero'),

    // Text length on a numeric column | integer('score', { length: 10 }) -> numeric('score', { precision: 10 })
    score: integer('score', { length: 10 }),

    // Declared type disagreeing with its column | n/a: the row is derived from the columns, so it cannot disagree with them
    nickname: text('nickname'),

    // Optimistic lock on a text column | n/a: Drizzle has no optimistic lock

    // Generated column reading a misspelled column | nmae -> name
    shout: text('shout').generatedAlwaysAs((): SQL => sql`upper(${users.nmae})`),

    // Foreign key of another type than the key it references | text('companyId') -> integer('companyId')
    companyId: text('companyId').references(() => companies.id),
  },
  (t) => [
    // Index on a missing column | emial -> email
    index('User_email_idx').on(t.emial),
  ],
);

export const companiesRelations = relations(companies, ({ many }) => ({
  users: many(users, { relationName: 'staff' }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  company: one(companies, {
    // Foreign key naming a missing column | users.companyid -> users.companyId
    fields: [users.companyid],
    references: [companies.id],
    // Inverse side naming a missing relation | 'staf' -> 'staff'
    relationName: 'staf',
  }),
}));
