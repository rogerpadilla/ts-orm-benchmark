import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { index, pgTable, serial, text } from 'drizzle-orm/pg-core';

declare const db: NodePgDatabase;

export const users = pgTable(
  'User',
  { id: serial().primaryKey(), emailAddress: text().notNull() },
  (t) => [
    // Expression index
    index().on(sql`lower(${t.emailAddress})`),
  ],
);

// Field in the filter
await db.select().from(users).where(eq(users.emailAddress, 'ada@example.com'));
// Field in inserted data
await db.insert(users).values({ emailAddress: 'ada@example.com' });
// Field in updated data
await db
  .update(users)
  .set({ emailAddress: 'ada@example.com' })
  .where(eq(users.id, 1));
