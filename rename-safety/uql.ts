import {
  Entity,
  Field,
  Id,
  Index,
  ManyToOne,
  OneToMany,
  raw,
  refs,
  type SqlQuerierPool,
} from 'uql-orm';

declare const pool: SqlQuerierPool;

@Entity()
export class Company {
  @Id({ type: Number }) id?: number;

  // Inverse side of a relation
  @OneToMany({ entity: () => User, mappedBy: (user) => user.employer })
  staff?: User[];
}

// Index on the field
@Index((user) => [user.emailAddress])
// Composite unique index
@Index((user) => [user.emailAddress, user.employerId], { unique: true })
// Covering index column
@Index((user) => [user.emailAddress], { include: (user) => [user.employerId] })
// Expression index
@Index((user) => [raw`lower(${user.emailAddress})`])
// Partial index condition
@Index((user) => [user.employerId], {
  where: (user) => raw`${user.emailAddress} <> ''`,
})
// Check constraint
@Entity({ checks: [{ where: (user) => raw`${user.emailAddress} <> ''` }] })
export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) emailAddress?: string;
  @Field({ type: Number, references: () => Company }) employerId?: number;

  // Foreign key of a relation
  @ManyToOne({ entity: () => Company, references: (user) => user.employerId })
  employer?: Company;

  // Generated column
  @Field({
    type: String,
    computed: (user) => raw`lower(${user.emailAddress})`,
    stored: true,
  })
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
  $where: { $and: [raw`lower(${u.emailAddress}) = ${'ada@example.com'}`] },
});
