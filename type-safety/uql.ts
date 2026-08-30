import { Company, User } from '../src/schema';
import { clients } from './clients';

const { uql } = clients;

// probe: select-key | emial -> email
await uql.findMany(User, {
  $select: { id: true, emial: true },
});

// probe: where-key | companyid -> companyId
await uql.findMany(User, {
  $select: { id: true },
  $where: { companyid: { $gt: 0 } },
});

// probe: where-value | 'one' -> 1
await uql.findMany(User, {
  $select: { id: true },
  $where: { companyId: 'one' },
});

// probe: where-operator | $like: 'abc' -> $gte: 1
await uql.findMany(User, {
  $select: { id: true },
  $where: { companyId: { $like: 'abc' } },
});

// probe: sort-key | idd -> id
await uql.findMany(User, {
  $select: { id: true },
  $sort: { idd: 1 },
});

// probe: nested-select-key | nmae -> name
await uql.findMany(Company, {
  $select: { id: true },
  $populate: { users: { $select: { nmae: true } } },
});

// probe: insert-key | emails -> email
await uql.insertMany(User, [{ name: 'New User', emails: 'new@example.com' }]);

// probe: update-value | 42 -> 'Updated Name'
await uql.updateMany(User, { $where: { id: 1 } }, { name: 42 });

// probe: result-unselected | user.email -> user.name
const [user] = await uql.findMany(User, { $select: { id: true, name: true } });
export const unselected = user.email;

// probe: result-nested | .nmae -> .name
const [company] = await uql.findMany(Company, {
  $select: { id: true },
  $populate: { users: { $select: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
