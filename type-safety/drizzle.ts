/**
 * Drizzle through its relational query API (`db.query.*`), not the `db.select()` builder the timed read
 * uses: it is the one of the two with a projection, a filter and a sort in one object, so the mistakes
 * below are the same mistakes the other five entries make rather than five different ones.
 */

import { eq } from 'drizzle-orm';
import { drizzleUsers } from '../src/schema';
import { clients } from './clients';

const { drizzleDb: db } = clients;

// probe: select-key | emial -> email
await db.query.User.findMany({
  columns: { id: true, emial: true },
});

// probe: where-key | companyid -> companyId
await db.query.User.findMany({
  columns: { id: true },
  where: (t, { gt }) => gt(t.companyid, 0),
});

// probe: where-value | 'one' -> 1
await db.query.User.findMany({
  columns: { id: true },
  where: (t, { eq }) => eq(t.companyId, 'one'),
});

// probe: where-operator | op.like(t.companyId, 'abc') -> op.gte(t.companyId, 1)
await db.query.User.findMany({
  columns: { id: true },
  where: (t, op) => op.like(t.companyId, 'abc'),
});

// probe: sort-key | t.idd -> t.id
await db.query.User.findMany({
  columns: { id: true },
  orderBy: (t, { asc }) => asc(t.idd),
});

// probe: nested-select-key | nmae -> name
await db.query.Company.findMany({
  columns: { id: true },
  with: { users: { columns: { nmae: true } } },
});

// probe: insert-key | emails -> email
await db.insert(drizzleUsers).values([{ name: 'New User', emails: 'new@example.com' }]);

// probe: update-value | 42 -> 'Updated Name'
await db.update(drizzleUsers).set({ name: 42 }).where(eq(drizzleUsers.id, 1));

// probe: result-unselected | user.email -> user.name
const [user] = await db.query.User.findMany({ columns: { id: true, name: true } });
export const unselected = user.email;

// probe: result-nested | .nmae -> .name
const [company] = await db.query.Company.findMany({
  columns: { id: true },
  with: { users: { columns: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
