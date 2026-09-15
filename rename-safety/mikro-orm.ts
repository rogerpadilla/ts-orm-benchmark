import { defineEntity, p } from '@mikro-orm/core';
import { type EntityManager, sql } from '@mikro-orm/postgresql';

export const Company = defineEntity({
  name: 'Company',
  properties: {
    id: p.integer().primary(),
    // Inverse side of a relation
    staff: () => p.oneToMany(User).mappedBy((user) => user.employer),
  },
});

export const User = defineEntity({
  name: 'User',
  properties: {
    id: p.integer().primary(),
    emailAddress: p.string(),
    // Foreign key of a relation
    employer: () => p.manyToOne(Company).joinColumn('employerId').nullable(),
    // Generated column
    emailLower: p
      .string()
      .generated((columns) => `lower(${columns.emailAddress}) stored`)
      .nullable(),
  },
  indexes: [
    // Index on the field
    { properties: ['emailAddress'] },
    // Covering index column
    { properties: ['emailAddress'], include: ['employer'] },
    // Expression index
    {
      expression: (columns, table, name) =>
        `create index ${name} on ${table} (lower(${columns.emailAddress}))`,
    },
    // Partial index condition
    { properties: ['employer'], where: { emailAddress: { $ne: '' } } },
  ],
  uniques: [
    // Composite unique index
    { properties: ['emailAddress', 'employer'] },
  ],
  checks: [
    // Check constraint
    { expression: (columns) => `${columns.emailAddress} <> ''` },
  ],
});

declare const em: EntityManager;

// Field in the projection
await em.find(User, {}, { fields: ['id', 'emailAddress'] });

// Field in the filter
await em.find(User, { emailAddress: 'ada@example.com' });

// Field in the sort
await em.find(User, {}, { orderBy: { emailAddress: 'asc' } });

// Field inside a loaded relation
await em.find(
  Company,
  {},
  { populate: ['staff'], fields: ['staff.emailAddress'] },
);

// Relation loaded by name
await em.find(User, {}, { populate: ['employer'] });

// Field in inserted data
await em.insert(User, { emailAddress: 'ada@example.com' });

// Field in updated data
await em.nativeUpdate(User, { id: 1 }, { emailAddress: 'ada@example.com' });

// Foreign key in a grouped count
await em
  .createQueryBuilder(User)
  .select(['employer', sql`count(*)`.as('total')])
  .groupBy('employer')
  .execute();

// Field read off the result
const [user] = await em.find(User, {});
export const address = user.emailAddress;

// Raw SQL in a filter
await em.find(User, {
  [sql`lower(${sql.ref('emailAddress')})`]: 'ada@example.com',
});
