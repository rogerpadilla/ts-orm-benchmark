import { Company, User } from '../src/schema';
import { clients } from './clients';

const { uql } = clients;

// Misspelled column in the projection | emial -> email
await uql.findMany(User, { $select: { id: true, emial: true } });

// Misspelled column in the filter | companyid -> companyId
await uql.findMany(User, {
  $select: { id: true },
  $where: { companyid: { $gt: 0 } },
});

// String value against a numeric column | 'one' -> 1
await uql.findMany(User, {
  $select: { id: true },
  $where: { companyId: 'one' },
});

// Text operator against a numeric column | $like: 'abc' -> $gte: 1
await uql.findMany(User, {
  $select: { id: true },
  $where: { companyId: { $like: 'abc' } },
});

// Misspelled column in the sort | idd -> id
await uql.findMany(User, { $select: { id: true }, $sort: { idd: 1 } });

// Misspelled column inside a loaded relation | nmae -> name
await uql.findMany(Company, {
  $select: { id: true },
  $populate: { users: { $select: { nmae: true } } },
});

// Misspelled column in inserted data | emails -> email
await uql.insertMany(User, [{ name: 'New User', emails: 'new@example.com' }]);

// Number written into a text column | 42 -> 'Updated Name'
await uql.updateMany(User, { $where: { id: 1 } }, { name: 42 });

// Reading a column the projection left out | user.email -> user.name
const [user] = await uql.findMany(User, { $select: { id: true, name: true } });
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await uql.findMany(Company, {
  $select: { id: true },
  $populate: { users: { $select: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
