/**
 * The one Company/User model, defined once per ORM, shared by both benchmarks.
 *
 * `compiler.bench.ts` compiles queries against these offline; `scripts/flow-bench.ts` executes them
 * against a real PostgreSQL. Sharing the definitions is what makes the two comparable: the flow
 * numbers describe the same entities the generation numbers were measured on.
 *
 * Definitions and fixtures only. Client construction lives in `src/clients.ts` (live connections) and
 * inline in `compiler.bench.ts` (offline stubs), because those two have nothing in common.
 */

import { defineEntity, p as mikroP } from '@mikro-orm/core';
import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { DataTypes, type Sequelize } from 'sequelize';
import { EntitySchema } from 'typeorm';
import { Entity, Field, Id, ManyToOne, OneToMany } from 'uql-orm';

export const USER_TABLE = 'User';
export const COMPANY_TABLE = 'Company';

// UQL

@Entity()
export class Company {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @OneToMany({ entity: () => User, mappedBy: (user) => user.company }) users?: User[];
}

@Entity()
export class User {
  @Id({ type: Number }) id?: number;
  @Field({ type: String }) name?: string;
  @Field({ type: String }) email?: string;
  @Field({ type: Number, references: () => Company }) companyId?: number;
  @Field({ type: Number }) createdAt?: number;
  @ManyToOne({ entity: () => Company }) company?: Company;
}

// TypeORM

/** `EntitySchema` derives its allowed keys from this, so relations need it stated. */
type TypeORMCompany = { id: number; name: string; users?: TypeORMUser[] };
type TypeORMUser = {
  id: number;
  name: string;
  email: string;
  companyId: number;
  createdAt: number;
  company?: TypeORMCompany;
};

export const TypeORMCompanySchema = new EntitySchema<TypeORMCompany>({
  name: 'Company',
  tableName: COMPANY_TABLE,
  columns: {
    id: { type: Number, primary: true, generated: true },
    name: { type: String },
  },
  relations: {
    users: { type: 'one-to-many', target: 'User', inverseSide: 'company' },
  },
});

export const TypeORMUserSchema = new EntitySchema<TypeORMUser>({
  name: 'User',
  tableName: USER_TABLE,
  columns: {
    id: { type: Number, primary: true, generated: true },
    name: { type: String },
    email: { type: String },
    companyId: { type: Number },
    createdAt: { type: Number },
  },
  relations: {
    company: { type: 'many-to-one', target: 'Company', joinColumn: { name: 'companyId' } },
  },
});

// MikroORM

export const MikroCompanySchema = defineEntity({
  name: 'Company',
  properties: {
    id: mikroP.integer().primary(),
    name: mikroP.string(),
    users: () => mikroP.oneToMany(MikroUserSchema).mappedBy('company'),
  },
});

/**
 * No scalar `companyId` here, unlike the other six: MikroORM refuses two persisted properties on one
 * column, and the `company` relation owns it. So MikroORM queries say `company` where the others say
 * `companyId`, which compiles to the identical `"u0"."companyId"` either way (verified against the
 * 0.6.1 SQL, byte for byte). `persist(false)` was tried first and rejected: it makes
 * `select(['companyId'])` silently omit the column, so the AGGREGATE case would have compiled one
 * fewer column than every other entry.
 */
export const MikroUserSchema = defineEntity({
  name: 'User',
  properties: {
    id: mikroP.integer().primary(),
    name: mikroP.string(),
    email: mikroP.string(),
    createdAt: mikroP.integer(),
    company: () => mikroP.manyToOne(MikroCompanySchema).joinColumn('companyId'),
  },
});

class MikroCompanyEntity extends MikroCompanySchema.class {}
MikroCompanySchema.setClass(MikroCompanyEntity);
class MikroUserEntity extends MikroUserSchema.class {}
MikroUserSchema.setClass(MikroUserEntity);

// Drizzle

const drizzleCompanies = pgTable(COMPANY_TABLE, {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const drizzleUsers = pgTable(USER_TABLE, {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  companyId: integer('companyId'),
  createdAt: integer('createdAt'),
});

/** Drizzle's `db.query.*.findMany({ with })` only exists when these are passed to `drizzle()`. */
const drizzleCompaniesRelations = relations(drizzleCompanies, ({ many }) => ({
  users: many(drizzleUsers),
}));

const drizzleUsersRelations = relations(drizzleUsers, ({ one }) => ({
  company: one(drizzleCompanies, { fields: [drizzleUsers.companyId], references: [drizzleCompanies.id] }),
}));

export const drizzleSchema = {
  Company: drizzleCompanies,
  User: drizzleUsers,
  drizzleCompaniesRelations,
  drizzleUsersRelations,
};

// Sequelize

/** Sequelize models bind to an instance, so this is a factory rather than a bare const. */
export function defineSequelizeModels(sequelize: Sequelize) {
  const SqCompany = sequelize.define(
    'Company',
    { name: DataTypes.STRING },
    { timestamps: false, tableName: COMPANY_TABLE, freezeTableName: true },
  );
  const SqUser = sequelize.define(
    'User',
    {
      name: DataTypes.STRING,
      email: DataTypes.STRING,
      companyId: DataTypes.INTEGER,
      createdAt: DataTypes.INTEGER,
    },
    { timestamps: false, tableName: USER_TABLE, freezeTableName: true },
  );
  SqUser.belongsTo(SqCompany, { foreignKey: 'companyId', as: 'company' });
  SqCompany.hasMany(SqUser, { foreignKey: 'companyId', as: 'users' });
  return { SqCompany, SqUser };
}

// Fixtures

export type CompanyRow = { id: number; name: string };
export type UserRow = { id: number; name: string; email: string; companyId: number; createdAt: number };

const COMPANY_COUNT = 50;
const USERS_PER_COMPANY = 4;

export const SEED_COMPANIES: readonly CompanyRow[] = Array.from({ length: COMPANY_COUNT }, (_, i) => ({
  id: i + 1,
  name: `Company ${i + 1}`,
}));

/**
 * 200 users across 50 companies. Sized so the flat read returns 200 rows and the nested read assembles
 * 50 parents with 4 children each: enough that hydration dominates the ~96µs the driver alone costs for
 * 200 rows, which is what makes the ORM differences visible rather than buried in round-trip time.
 */
export const SEED_USERS: readonly UserRow[] = Array.from({ length: COMPANY_COUNT * USERS_PER_COMPANY }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  companyId: (i % COMPANY_COUNT) + 1,
  createdAt: 1_000_000 + i,
}));

export const TABLE_DDL = [
  `CREATE TABLE "${COMPANY_TABLE}" (
    id serial PRIMARY KEY,
    name text NOT NULL
  )`,
  `CREATE TABLE "${USER_TABLE}" (
    id serial PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    "companyId" int REFERENCES "${COMPANY_TABLE}"(id),
    "createdAt" int
  )`,
  `CREATE INDEX "User_companyId_idx" ON "${USER_TABLE}" ("companyId")`,
];
