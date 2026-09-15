import type { PrismaClient } from './prisma/generated/client';

declare const prisma: PrismaClient;

// Field in the projection
await prisma.user.findMany({ select: { id: true, emailAddress: true } });

// Field in the filter
await prisma.user.findMany({ where: { emailAddress: 'ada@example.com' } });

// Field in the sort
await prisma.user.findMany({ orderBy: { emailAddress: 'asc' } });

// Field inside a loaded relation
await prisma.company.findMany({
  select: { staff: { select: { emailAddress: true } } },
});

// Relation loaded by name
await prisma.user.findMany({ include: { employer: true } });

// Field in inserted data
await prisma.user.create({ data: { emailAddress: 'ada@example.com' } });

// Field in updated data
await prisma.user.updateMany({
  where: { id: 1 },
  data: { emailAddress: 'ada@example.com' },
});

// Foreign key in a grouped count
await prisma.user.groupBy({ by: ['employerId'], _count: true });

// Field read off the result
const [user] = await prisma.user.findMany();
export const address = user.emailAddress;

// Raw SQL in a filter
await prisma.$queryRaw`SELECT id FROM "User" WHERE lower("emailAddress") = ${'ada@example.com'}`;
