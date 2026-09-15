import { count, eq, relations, type SQL, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const companies = pgTable('Company', { id: serial().primaryKey() });

export const users = pgTable(
  'User',
  {
    id: serial().primaryKey(),
    emailAddress: text().notNull(),
    employerId: integer().references(() => companies.id),
    // Generated column
    emailLower: text().generatedAlwaysAs(
      (): SQL => sql`lower(${users.emailAddress})`,
    ),
  },
  (t) => [
    // Index on the field
    index().on(t.emailAddress),
    // Composite unique index
    uniqueIndex().on(t.emailAddress, t.employerId),
    // Covering index column | n/a: Drizzle's index builder has no INCLUDE
    // Expression index
    index().on(sql`lower(${t.emailAddress})`),
    // Partial index condition
    index()
      .on(t.employerId)
      .where(sql`${t.emailAddress} <> ''`),
    // Check constraint
    check('address_present', sql`${t.emailAddress} <> ''`),
  ],
);

export const usersRelations = relations(users, ({ one }) => ({
  // Foreign key of a relation
  employer: one(companies, {
    fields: [users.employerId],
    references: [companies.id],
  }),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  // Inverse side of a relation
  staff: many(users),
}));

const schema = { companies, users, usersRelations, companiesRelations };
declare const db: NodePgDatabase<typeof schema>;

// Field in the projection
await db.select({ id: users.id, address: users.emailAddress }).from(users);

// Field in the filter
await db.select().from(users).where(eq(users.emailAddress, 'ada@example.com'));

// Field in the sort
await db.select().from(users).orderBy(users.emailAddress);

// Field inside a loaded relation
await db.query.companies.findMany({
  with: { staff: { columns: { emailAddress: true } } },
});

// Relation loaded by name
await db.query.users.findMany({ with: { employer: true } });

// Field in inserted data
await db.insert(users).values({ emailAddress: 'ada@example.com' });

// Field in updated data
await db
  .update(users)
  .set({ emailAddress: 'ada@example.com' })
  .where(eq(users.id, 1));

// Foreign key in a grouped count
await db
  .select({ company: users.employerId, total: count() })
  .from(users)
  .groupBy(users.employerId);

// Field read off the result
const [user] = await db.select().from(users);
export const address = user.emailAddress;

// Raw SQL in a filter
await db
  .select()
  .from(users)
  .where(sql`lower(${users.emailAddress}) = ${'ada@example.com'}`);
