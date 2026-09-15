import { Entity, Field, Id, Index, raw, type SqlQuerierPool } from 'uql-orm';

declare const pool: SqlQuerierPool;

// Expression index
@Index((user) => [raw`lower(${user.emailAddress})`])
@Entity()
export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) emailAddress?: string;
}

// Field in the filter
await pool.findMany(User, { $where: { emailAddress: 'ada@example.com' } });
// Field in inserted data
await pool.insertOne(User, { emailAddress: 'ada@example.com' });
// Field in updated data
await pool.updateOneById(User, 1, { emailAddress: 'ada@example.com' });
