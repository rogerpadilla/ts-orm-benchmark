import { Like, MoreThan } from 'typeorm';
import { TypeORMCompanySchema, TypeORMUserSchema } from '../src/schema';
import { clients } from './clients';

const users = clients.typeorm.getRepository(TypeORMUserSchema);
const companies = clients.typeorm.getRepository(TypeORMCompanySchema);

// Misspelled column in the projection | emial -> email
await users.find({ select: { id: true, emial: true } });

// Misspelled column in the filter | companyid -> companyId
await users.find({ select: { id: true }, where: { companyid: MoreThan(0) } });

// String value against a numeric column | 'one' -> 1
await users.find({ select: { id: true }, where: { companyId: 'one' } });

// Text operator against a numeric column | Like('abc') -> MoreThan(1)
await users.find({ select: { id: true }, where: { companyId: Like('abc') } });

// Misspelled column in the sort | idd -> id
await users.find({ select: { id: true }, order: { idd: 'ASC' } });

// Misspelled column inside a loaded relation | nmae -> name
await companies.find({
  select: { id: true, users: { nmae: true } },
  relations: { users: true },
});

// Misspelled column in inserted data | emails -> email
await users.insert({ name: 'New User', emails: 'new@example.com' });

// Number written into a text column | 42 -> 'Updated Name'
await users.update({ id: 1 }, { name: 42 });

// Reading a column the projection left out | user.email -> user.name
const [user] = await users.find({ select: { id: true, name: true } });
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await companies.find({
  select: { id: true, users: { id: true, name: true } },
  relations: { users: true },
});
export const nested = company.users![0].nmae;
