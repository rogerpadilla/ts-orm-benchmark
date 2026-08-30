/**
 * The one Company/User model, defined once per ORM. Same shape for everyone is what makes the entries
 * comparable at all.
 *
 * Definitions only: the live connections are `src/clients.ts`, the rows every entry is seeded with are
 * `scripts/fixture.ts`, and the lifecycle is `scripts/flow-bench.ts`.
 */

import { defineEntity, p as mikroP } from '@mikro-orm/core';
import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import {
  type CreationOptional,
  DataTypes,
  type InferAttributes,
  type InferCreationAttributes,
  Model,
  type NonAttribute,
  type Sequelize,
} from 'sequelize';
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

/**
 * `EntitySchema` rather than the decorators TypeORM's docs lead with, and not as a preference: at 1.1.0
 * those decorators are still the legacy kind, so they need `experimentalDecorators` - which this project
 * does not set, because the standard TC39 decorators are what UQL's entry compiles with and one project
 * has one setting. Measured before settling for it: compiled with the flag on, the decorator entities
 * score the same nine of ten and miss the same probe (`result-unselected`), so nothing about the table
 * turns on this.
 */

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

/**
 * `defineEntity` is not one of two options here: 7.x exports no `@Entity`, `@PrimaryKey`, `@Property`,
 * `@ManyToOne` or `@OneToMany` at all, so this is MikroORM's API rather than a style chosen for it.
 */

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
 * `companyId`, which compiles to the identical `"u0"."companyId"` either way. `persist(false)` was tried
 * first and rejected: it makes `select(['companyId'])` silently omit the column.
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

export class SqCompany extends Model<InferAttributes<SqCompany>, InferCreationAttributes<SqCompany>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare users?: NonAttribute<SqUser[]>;
}

export class SqUser extends Model<InferAttributes<SqUser>, InferCreationAttributes<SqUser>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare companyId: number;
  declare createdAt: number;
}

/** `init` binds a class to one connection, so the two above are singletons bound by whoever calls this. */
export function defineSequelizeModels(sequelize: Sequelize) {
  SqCompany.init(
    { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: DataTypes.STRING },
    { sequelize, timestamps: false, tableName: COMPANY_TABLE, freezeTableName: true },
  );
  SqUser.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: DataTypes.STRING,
      email: DataTypes.STRING,
      companyId: DataTypes.INTEGER,
      createdAt: DataTypes.INTEGER,
    },
    { sequelize, timestamps: false, tableName: USER_TABLE, freezeTableName: true },
  );
  SqUser.belongsTo(SqCompany, { foreignKey: 'companyId', as: 'company' });
  SqCompany.hasMany(SqUser, { foreignKey: 'companyId', as: 'users' });
  return { SqCompany, SqUser };
}
