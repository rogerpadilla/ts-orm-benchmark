import { asc, eq, gt, like } from 'drizzle-orm';
import { drizzleUsers } from '../src/schema';
import { clients } from './clients';

const { drizzleDb: db } = clients;

// Misspelled column in the projection | emial -> email
await db
  .select({ id: drizzleUsers.id, email: drizzleUsers.emial })
  .from(drizzleUsers);

// Misspelled column in the filter | companyid -> companyId
await db
  .select({ id: drizzleUsers.id })
  .from(drizzleUsers)
  .where(gt(drizzleUsers.companyid, 0));

// String value against a numeric column | 'one' -> 1
await db
  .select({ id: drizzleUsers.id })
  .from(drizzleUsers)
  .where(eq(drizzleUsers.companyId, 'one'));

// Text operator against a numeric column | like(drizzleUsers.companyId, 'abc') -> gt(drizzleUsers.companyId, 1)
await db
  .select({ id: drizzleUsers.id })
  .from(drizzleUsers)
  .where(like(drizzleUsers.companyId, 'abc'));

// Misspelled column in the sort | drizzleUsers.idd -> drizzleUsers.id
await db
  .select({ id: drizzleUsers.id })
  .from(drizzleUsers)
  .orderBy(asc(drizzleUsers.idd));

// Misspelled column inside a loaded relation | nmae -> name
await db.query.Company.findMany({
  columns: { id: true },
  with: { users: { columns: { nmae: true } } },
});

// Misspelled column in inserted data | emails -> email
await db
  .insert(drizzleUsers)
  .values([{ name: 'New User', emails: 'new@example.com' }]);

// Number written into a text column | 42 -> 'Updated Name'
await db.update(drizzleUsers).set({ name: 42 }).where(eq(drizzleUsers.id, 1));

// Reading a column the projection left out | user.email -> user.name
const [user] = await db
  .select({ id: drizzleUsers.id, name: drizzleUsers.name })
  .from(drizzleUsers);
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await db.query.Company.findMany({
  columns: { id: true },
  with: { users: { columns: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
