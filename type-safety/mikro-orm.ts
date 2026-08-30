/**
 * MikroORM's `User` has no scalar `companyId`: the `company` relation owns that column, for the reason
 * `src/schema.ts` records. So the filter probes here name `createdAt`, the other numeric column, and say
 * exactly what the same probe says everywhere else.
 */

import { MikroCompanySchema, MikroUserSchema } from '../src/schema';
import { clients } from './clients';

const em = clients.mikroOrm.em;

// Misspelled column in the projection | emial -> email
await em.find(MikroUserSchema, {}, { fields: ['id', 'emial'] });

// Misspelled column in the filter | createdat -> createdAt
await em.find(MikroUserSchema, { createdat: { $gt: 0 } }, { fields: ['id'] });

// String value against a numeric column | 'one' -> 1
await em.find(MikroUserSchema, { createdAt: 'one' }, { fields: ['id'] });

// Text operator against a numeric column | $like: 'abc' -> $gte: 1
await em.find(MikroUserSchema, { createdAt: { $like: 'abc' } }, { fields: ['id'] });

// Misspelled column in the sort | idd -> id
await em.find(MikroUserSchema, {}, { fields: ['id'], orderBy: { idd: 'ASC' } });

// Misspelled column inside a loaded relation | users.nmae -> users.name
await em.find(MikroCompanySchema, {}, { fields: ['id', 'users.nmae'], populate: ['users'] });

// Misspelled column in inserted data | emails -> email
await em
  .createQueryBuilder(MikroUserSchema)
  .insert([{ name: 'New User', emails: 'new@example.com', createdAt: 1, company: 1 }])
  .execute();

// Number written into a text column | 42 -> 'Updated Name'
await em.nativeUpdate(MikroUserSchema, { id: 1 }, { name: 42 });

// Reading a column the projection left out | user.email -> user.name
const [user] = await em.find(MikroUserSchema, {}, { fields: ['id', 'name'] });
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await em.find(
  MikroCompanySchema,
  {},
  { fields: ['id', 'users.id', 'users.name'], populate: ['users'] },
);
export const nested = company.users[0].nmae;
