import {
  Check,
  Column,
  type DataSource,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Raw,
} from 'typeorm';

@Entity()
export class Company {
  @PrimaryGeneratedColumn() id!: number;

  // Inverse side of a relation
  @OneToMany(() => User, (user) => user.employer)
  staff?: User[];
}

// Index on the field
@Index((user: User) => [user.emailAddress])
// Composite unique index
@Index((user: User) => [user.emailAddress, user.employerId], { unique: true })
// Covering index column | n/a: TypeORM's index options have no INCLUDE
// Expression index | n/a: TypeORM indexes columns, never an expression
// Partial index condition
@Index((user: User) => [user.employerId], { where: `"emailAddress" <> ''` })
// Check constraint
@Check(`"emailAddress" <> ''`)
@Entity()
export class User {
  @PrimaryGeneratedColumn() id!: number;
  @Column() emailAddress!: string;
  @Column({ nullable: true }) employerId?: number;

  // Foreign key of a relation
  @ManyToOne(() => Company, (company) => company.staff)
  @JoinColumn({ name: 'employerId' })
  employer?: Company;

  // Generated column
  @Column({ generatedType: 'STORED', asExpression: 'lower("emailAddress")' })
  emailLower?: string;
}

declare const dataSource: DataSource;
const users = dataSource.getRepository(User);
const companies = dataSource.getRepository(Company);

// Field in the projection
await users.find({ select: { id: true, emailAddress: true } });

// Field in the filter
await users.find({ where: { emailAddress: 'ada@example.com' } });

// Field in the sort
await users.find({ order: { emailAddress: 'ASC' } });

// Field inside a loaded relation
await companies.find({
  relations: { staff: true },
  select: { id: true, staff: { emailAddress: true } },
});

// Relation loaded by name
await users.find({ relations: { employer: true } });

// Field in inserted data
await users.insert({ emailAddress: 'ada@example.com' });

// Field in updated data
await users.update({ id: 1 }, { emailAddress: 'ada@example.com' });

// Foreign key in a grouped count
await users
  .createQueryBuilder('user')
  .select('user.employerId')
  .addSelect('COUNT(*)', 'total')
  .groupBy('user.employerId')
  .getRawMany();

// Field read off the result
const [user] = await users.find();
export const address = user.emailAddress;

// Raw SQL in a filter
await users.find({
  where: {
    emailAddress: Raw((column) => `lower(${column}) = :value`, {
      value: 'ada@example.com',
    }),
  },
});
