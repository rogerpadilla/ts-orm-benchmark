import { Like, MoreThan } from 'typeorm';
import { TypeORMCompanySchema, TypeORMUserSchema } from '../src/schema';
import { clients } from './clients';

const users = clients.typeorm.getRepository(TypeORMUserSchema);
const companies = clients.typeorm.getRepository(TypeORMCompanySchema);

// probe: select-key | emial -> email
await users.find({
  select: { id: true, emial: true },
});

// probe: where-key | companyid -> companyId
await users.find({
  select: { id: true },
  where: { companyid: MoreThan(0) },
});

// probe: where-value | 'one' -> 1
await users.find({
  select: { id: true },
  where: { companyId: 'one' },
});

// probe: where-operator | Like('abc') -> MoreThan(1)
await users.find({
  select: { id: true },
  where: { companyId: Like('abc') },
});

// probe: sort-key | idd -> id
await users.find({
  select: { id: true },
  order: { idd: 'ASC' },
});

// probe: nested-select-key | nmae -> name
await companies.find({
  select: { id: true, users: { nmae: true } },
  relations: { users: true },
});

// probe: insert-key | emails -> email
await users.insert({ name: 'New User', emails: 'new@example.com' });

// probe: update-value | 42 -> 'Updated Name'
await users.update({ id: 1 }, { name: 42 });

// probe: result-unselected | user.email -> user.name
const [user] = await users.find({ select: { id: true, name: true } });
export const unselected = user.email;

// probe: result-nested | .nmae -> .name
const [company] = await companies.find({
  select: { id: true, users: { id: true, name: true } },
  relations: { users: true },
});
export const nested = company.users![0].nmae;
