import {
  Computed,
  Entity,
  f,
  Field,
  ManyToOne,
  OneToMany,
  refs,
  sql,
  type SqlQuerierPool,
} from 'uql-orm';

declare const pool: SqlQuerierPool;

@Entity()
export class Company {
  @Field(f.number().id()) id?: number;

  // Inverse side of a relation
  @OneToMany({ entity: () => User, mappedBy: (user) => user.employer })
  staff?: User[];
}

@Entity({
  indexes: (user, index) => [
    // Index on the field
    index([user.emailAddress]),
    // Composite unique index
    index([user.emailAddress, user.employerId], { unique: true }),
    // Covering index column
    index([user.emailAddress], { include: [user.employerId] }),
    // Expression index
    index([sql`lower(${user.emailAddress})`]),
    // Partial index condition
    index([user.employerId], { where: sql`${user.emailAddress} <> ''` }),
  ],
  // Check constraint
  checks: (user, check) => [check(sql`${user.emailAddress} <> ''`)],
})
export class User {
  @Field(f.number().id()) id?: number;
  @Field(f.string()) emailAddress!: string;
  @Field(f.references(() => Company).nullable()) employerId?: number | null;

  // Foreign key of a relation
  @ManyToOne({ entity: () => Company, references: (user) => user.employerId })
  employer?: Company;

  // Generated column
  @Computed((user) =>
    f
      .string()
      .as(sql`lower(${user.emailAddress})`)
      .stored(),
  )
  emailLower?: string;
}

// Field in the projection
await pool.findMany(User, { $select: { id: true, emailAddress: true } });

// Field in the filter
await pool.findMany(User, { $where: { emailAddress: 'ada@example.com' } });

// Field in the sort
await pool.findMany(User, { $sort: { emailAddress: 1 } });

// Field inside a loaded relation
await pool.findMany(Company, {
  $populate: { staff: { $select: { emailAddress: true } } },
});

// Relation loaded by name
await pool.findMany(User, { $populate: { employer: true } });

// Field in inserted data
await pool.insertOne(User, { emailAddress: 'ada@example.com' });

// Field in updated data
await pool.updateOneById(User, 1, { emailAddress: 'ada@example.com' });

// Foreign key in a grouped count
await pool.aggregate(User, {
  $group: { employerId: true },
  $select: { total: { $count: '*' } },
});

// Field read off the result
const [user] = await pool.findMany(User, { $select: { emailAddress: true } });
export const address = user.emailAddress;

// Raw SQL in a filter
const u = refs(User);
await pool.findMany(User, {
  $where: { $and: [sql`lower(${u.emailAddress}) = ${'ada@example.com'}`] },
});
