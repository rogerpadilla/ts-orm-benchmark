/**
 * MikroORM's `User` has no scalar `companyId`: the `company` relation owns that column, for the reason
 * `src/schema.ts` records. So the filter probes here name `createdAt`, the other numeric column, and say
 * exactly what the same probe says everywhere else.
 */

import { MikroCompanySchema, MikroUserSchema } from '../src/schema';
import { clients } from './clients';

const em = clients.mikroOrm.em;

// probe: select-key | emial -> email
await em.find(MikroUserSchema, {}, { fields: ['id', 'emial'] });

// probe: where-key | createdat -> createdAt
await em.find(MikroUserSchema, { createdat: { $gt: 0 } }, { fields: ['id'] });

// probe: where-value | 'one' -> 1
await em.find(MikroUserSchema, { createdAt: 'one' }, { fields: ['id'] });

// probe: where-operator | $like: 'abc' -> $gte: 1
await em.find(MikroUserSchema, { createdAt: { $like: 'abc' } }, { fields: ['id'] });

// probe: sort-key | idd -> id
await em.find(MikroUserSchema, {}, { fields: ['id'], orderBy: { idd: 'ASC' } });

// probe: nested-select-key | users.nmae -> users.name
await em.find(MikroCompanySchema, {}, { fields: ['id', 'users.nmae'], populate: ['users'] });

// probe: insert-key | emails -> email
await em
  .createQueryBuilder(MikroUserSchema)
  .insert([{ name: 'New User', emails: 'new@example.com', createdAt: 1, company: 1 }])
  .execute();

// probe: update-value | 42 -> 'Updated Name'
await em.nativeUpdate(MikroUserSchema, { id: 1 }, { name: 42 });

// probe: result-unselected | user.email -> user.name
const [user] = await em.find(MikroUserSchema, {}, { fields: ['id', 'name'] });
export const unselected = user.email;

// probe: result-nested | .nmae -> .name
const [company] = await em.find(
  MikroCompanySchema,
  {},
  { fields: ['id', 'users.id', 'users.name'], populate: ['users'] },
);
export const nested = company.users[0].nmae;
