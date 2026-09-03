import { eq } from 'drizzle-orm';
import { drizzleUsers } from '../src/schema';
import { clients } from './clients';

const { drizzleDb: db } = clients;

// Misspelled column in the projection | emial -> email
await db.query.User.findMany({
  columns: { id: true, emial: true },
});

// Misspelled column in the filter | companyid -> companyId
await db.query.User.findMany({
  columns: { id: true },
  where: (t, { gt }) => gt(t.companyid, 0),
});

// String value against a numeric column | 'one' -> 1
await db.query.User.findMany({
  columns: { id: true },
  where: (t, { eq }) => eq(t.companyId, 'one'),
});

// Text operator against a numeric column | op.like(t.companyId, 'abc') -> op.gte(t.companyId, 1)
await db.query.User.findMany({
  columns: { id: true },
  where: (t, op) => op.like(t.companyId, 'abc'),
});

// Misspelled column in the sort | t.idd -> t.id
await db.query.User.findMany({
  columns: { id: true },
  orderBy: (t, { asc }) => asc(t.idd),
});

// Misspelled column inside a loaded relation | nmae -> name
await db.query.Company.findMany({
  columns: { id: true },
  with: { users: { columns: { nmae: true } } },
});

// Misspelled column in inserted data | emails -> email
await db.insert(drizzleUsers).values([{ name: 'New User', emails: 'new@example.com' }]);

// Number written into a text column | 42 -> 'Updated Name'
await db.update(drizzleUsers).set({ name: 42 }).where(eq(drizzleUsers.id, 1));

// Reading a column the projection left out | user.email -> user.name
const [user] = await db.query.User.findMany({ columns: { id: true, name: true } });
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await db.query.Company.findMany({
  columns: { id: true },
  with: { users: { columns: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
