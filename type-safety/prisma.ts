import { clients } from './clients';

const { prisma } = clients;

// Misspelled column in the projection | emial -> email
await prisma.user.findMany({ select: { id: true, emial: true } });

// Misspelled column in the filter | companyid -> companyId
await prisma.user.findMany({
  select: { id: true },
  where: { companyid: { gt: 0 } },
});

// String value against a numeric column | 'one' -> 1
await prisma.user.findMany({
  select: { id: true },
  where: { companyId: 'one' },
});

// Text operator against a numeric column | contains: 'abc' -> gte: 1
await prisma.user.findMany({
  select: { id: true },
  where: { companyId: { contains: 'abc' } },
});

// Misspelled column in the sort | idd -> id
await prisma.user.findMany({ select: { id: true }, orderBy: { idd: 'asc' } });

// Misspelled column inside a loaded relation | nmae -> name
await prisma.company.findMany({
  select: { id: true, users: { select: { nmae: true } } },
});

// Misspelled column in inserted data | emails -> email
await prisma.user.createManyAndReturn({
  data: [{ name: 'New User', emails: 'new@example.com' }],
  select: { id: true },
});

// Number written into a text column | 42 -> 'Updated Name'
await prisma.user.update({ where: { id: 1 }, data: { name: 42 } });

// Reading a column the projection left out | user.email -> user.name
const [user] = await prisma.user.findMany({ select: { id: true, name: true } });
export const unselected = user.email;

// Reading a misspelled column off a loaded relation | .nmae -> .name
const [company] = await prisma.company.findMany({
  select: { id: true, users: { select: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
