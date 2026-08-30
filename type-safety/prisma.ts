import { clients } from './clients';

const { prisma } = clients;

// probe: select-key | emial -> email
await prisma.user.findMany({
  select: { id: true, emial: true },
});

// probe: where-key | companyid -> companyId
await prisma.user.findMany({
  select: { id: true },
  where: { companyid: { gt: 0 } },
});

// probe: where-value | 'one' -> 1
await prisma.user.findMany({
  select: { id: true },
  where: { companyId: 'one' },
});

// probe: where-operator | contains: 'abc' -> gte: 1
await prisma.user.findMany({
  select: { id: true },
  where: { companyId: { contains: 'abc' } },
});

// probe: sort-key | idd -> id
await prisma.user.findMany({
  select: { id: true },
  orderBy: { idd: 'asc' },
});

// probe: nested-select-key | nmae -> name
await prisma.company.findMany({
  select: { id: true, users: { select: { nmae: true } } },
});

// probe: insert-key | emails -> email
await prisma.user.createManyAndReturn({
  data: [{ name: 'New User', emails: 'new@example.com' }],
  select: { id: true },
});

// probe: update-value | 42 -> 'Updated Name'
await prisma.user.update({ where: { id: 1 }, data: { name: 42 } });

// probe: result-unselected | user.email -> user.name
const [user] = await prisma.user.findMany({ select: { id: true, name: true } });
export const unselected = user.email;

// probe: result-nested | .nmae -> .name
const [company] = await prisma.company.findMany({
  select: { id: true, users: { select: { id: true, name: true } } },
});
export const nested = company.users[0].nmae;
