/**
 * TypeScript ORM SQL Generation Benchmark
 *
 * Measures pure SQL generation performance (no DB I/O) across:
 * - UQL         — Object-based queries, pre-computed metadata
 * - Sequelize   — Classic ORM, QueryGenerator API
 * - TypeORM     — EntitySchema + QueryBuilder
 * - MikroORM    — EntitySchema + Knex-backed QueryBuilder
 * - Drizzle     — Functional SQL builder
 *
 * Only full ORMs are included (no standalone query builders like Knex or Kysely).
 * Each ORM defines the same User entity and compiles equivalent queries.
 * Run: npm run bench
 */
import { beforeAll, bench, describe } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Entity Definitions — same schema across all ORMs
// ─────────────────────────────────────────────────────────────────────────────

// ── UQL ──────────────────────────────────────────────────────────────────────
import { Entity, Field, Id } from 'uql-orm';
import { PostgresDialect as UqlDialect } from 'uql-orm/postgres';

@Entity()
class User {
  @Id() id?: number;
  @Field() name?: string;
  @Field() email?: string;
  @Field() companyId?: number;
  @Field() createdAt?: number;
}

const uqlDialect = new UqlDialect();

// ── Sequelize ────────────────────────────────────────────────────────────────
import { DataTypes, Op, Sequelize } from 'sequelize';

const sequelize = new Sequelize('postgres://x:x@localhost/x', { logging: false, dialect: 'postgres' });
sequelize.define('User', {
  name: DataTypes.STRING,
  email: DataTypes.STRING,
  companyId: DataTypes.INTEGER,
  createdAt: DataTypes.INTEGER,
}, { timestamps: false, tableName: 'User', freezeTableName: true });

const seqQg = sequelize.getQueryInterface().queryGenerator as any;

// ── TypeORM ──────────────────────────────────────────────────────────────────
import { Brackets, DataSource, EntitySchema } from 'typeorm';

const TypeORMUserSchema = new EntitySchema({
  name: 'User',
  tableName: 'User',
  columns: {
    id: { type: Number, primary: true, generated: true },
    name: { type: String },
    email: { type: String },
    companyId: { type: Number },
    createdAt: { type: Number },
  },
} as any);

let typeormDs: DataSource;

// ── MikroORM ─────────────────────────────────────────────────────────────────
import { EntitySchema as MikroEntitySchema, MikroORM, defineConfig } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/knex';

interface MikroUser {
  id: number;
  name: string;
  email: string;
  companyId: number;
  createdAt: number;
}

const MikroUserSchema = new MikroEntitySchema<MikroUser>({
  name: 'MikroUser',
  tableName: 'User',
  properties: {
    id: { type: 'number', primary: true },
    name: { type: 'string' },
    email: { type: 'string' },
    companyId: { type: 'number' },
    createdAt: { type: 'number' },
  },
});

let mikroEm: SqlEntityManager;

// ── Drizzle ──────────────────────────────────────────────────────────────────
import { and, eq, gt, ilike, inArray, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

const drizzleUsers = pgTable('User', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  companyId: integer('companyId'),
  createdAt: integer('createdAt'),
});

const drizzleDb = drizzle({ client: { connect: () => ({}) } as any });

// ─────────────────────────────────────────────────────────────────────────────
// Global Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // TypeORM needs a DataSource for metadata (in-memory SQLite, no real DB)
  typeormDs = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [TypeORMUserSchema as any],
    synchronize: false,
    logging: false,
  });
  await typeormDs.initialize();

  // MikroORM needs an EntityManager (in-memory SQLite, no real DB)
  const orm = await MikroORM.init(
    defineConfig({
      dbName: ':memory:',
      driver: (await import('@mikro-orm/better-sqlite')).BetterSqliteDriver,
      entities: [MikroUserSchema],
      connect: false,
    }),
  );
  mikroEm = orm.em.fork() as unknown as SqlEntityManager;
});

// ─────────────────────────────────────────────────────────────────────────────
// Benchmarks
// ─────────────────────────────────────────────────────────────────────────────

describe('SELECT — simple (1 field, no WHERE)', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.find(ctx, User, { $select: { name: true } });
  });

  bench('Sequelize', () => {
    seqQg.selectQuery('User', { attributes: ['name'] });
  });

  bench('TypeORM', () => {
    typeormDs.createQueryBuilder().select(['User.name']).from('User', 'User').getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm.createQueryBuilder(MikroUserSchema).select(['name']).getKnexQuery().toSQL();
  });

  bench('Drizzle', () => {
    drizzleDb.select({ name: drizzleUsers.name }).from(drizzleUsers).toSQL();
  });
});

describe('SELECT — WHERE + SORT + LIMIT', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.find(ctx, User, {
      $select: { id: true, name: true },
      $where: { name: 'John', companyId: { $gt: 5 } },
      $sort: { name: 1 },
      $limit: 10,
      $skip: 20,
    });
  });

  bench('Sequelize', () => {
    seqQg.selectQuery('User', {
      attributes: ['id', 'name'],
      where: { name: 'John', companyId: { [Op.gt]: 5 } },
      order: [['name', 'ASC']],
      limit: 10,
      offset: 20,
    });
  });

  bench('TypeORM', () => {
    typeormDs
      .createQueryBuilder()
      .select(['User.id', 'User.name'])
      .from('User', 'User')
      .where('User.name = :name', { name: 'John' })
      .andWhere('User.companyId > :companyId', { companyId: 5 })
      .orderBy('User.name', 'ASC')
      .limit(10)
      .offset(20)
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm
      .createQueryBuilder(MikroUserSchema)
      .select(['id', 'name'])
      .where({ name: 'John', companyId: { $gt: 5 } })
      .orderBy({ name: 'ASC' })
      .limit(10)
      .offset(20)
      .getKnexQuery()
      .toSQL();
  });

  bench('Drizzle', () => {
    drizzleDb
      .select({ id: drizzleUsers.id, name: drizzleUsers.name })
      .from(drizzleUsers)
      .where(and(eq(drizzleUsers.name, 'John'), gt(drizzleUsers.companyId, 5)))
      .orderBy(drizzleUsers.name)
      .limit(10)
      .offset(20)
      .toSQL();
  });
});

describe('SELECT — complex $or + operators', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.find(ctx, User, {
      $select: { id: true, name: true, email: true },
      $where: {
        $or: [
          { name: { $ilike: '%john%' }, companyId: { $in: [1, 2, 3] } },
          { email: { $like: '%@example.com' }, createdAt: { $gt: 1000 } },
        ],
      },
      $sort: { createdAt: -1, name: 1 },
      $limit: 50,
    });
  });

  bench('Sequelize', () => {
    seqQg.selectQuery('User', {
      attributes: ['id', 'name', 'email'],
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: '%john%' }, companyId: { [Op.in]: [1, 2, 3] } },
          { email: { [Op.like]: '%@example.com' }, createdAt: { [Op.gt]: 1000 } },
        ],
      },
      order: [['createdAt', 'DESC'], ['name', 'ASC']],
      limit: 50,
    });
  });

  bench('TypeORM', () => {
    typeormDs
      .createQueryBuilder()
      .select(['User.id', 'User.name', 'User.email'])
      .from('User', 'User')
      .where(
        new Brackets((qb) => {
          qb.where('User.name ILIKE :name1', { name1: '%john%' }).andWhere(
            'User.companyId IN (:...companyIds)',
            { companyIds: [1, 2, 3] },
          );
        }),
      )
      .orWhere(
        new Brackets((qb) => {
          qb.where('User.email LIKE :email', { email: '%@example.com' }).andWhere(
            'User.createdAt > :createdAt',
            { createdAt: 1000 },
          );
        }),
      )
      .orderBy('User.createdAt', 'DESC')
      .addOrderBy('User.name', 'ASC')
      .limit(50)
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm
      .createQueryBuilder(MikroUserSchema)
      .select(['id', 'name', 'email'])
      .where({
        $or: [
          { name: { $ilike: '%john%' }, companyId: { $in: [1, 2, 3] } },
          { email: { $like: '%@example.com' }, createdAt: { $gt: 1000 } },
        ],
      })
      .orderBy({ createdAt: 'DESC', name: 'ASC' })
      .limit(50)
      .getKnexQuery()
      .toSQL();
  });

  bench('Drizzle', () => {
    drizzleDb
      .select({ id: drizzleUsers.id, name: drizzleUsers.name, email: drizzleUsers.email })
      .from(drizzleUsers)
      .where(
        or(
          and(ilike(drizzleUsers.name, '%john%'), inArray(drizzleUsers.companyId, [1, 2, 3])),
          and(ilike(drizzleUsers.email, '%@example.com'), gt(drizzleUsers.createdAt, 1000)),
        ),
      )
      .limit(50)
      .toSQL();
  });
});

describe('INSERT — batch (10 rows)', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    name: `User ${i}`,
    email: `user${i}@example.com`,
    companyId: i,
    createdAt: Date.now(),
  }));

  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.insert(ctx, User, rows);
  });

  bench('Sequelize', () => {
    seqQg.bulkInsertQuery('User', rows);
  });

  bench('TypeORM', () => {
    typeormDs.createQueryBuilder().insert().into('User').values(rows).getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm.createQueryBuilder(MikroUserSchema).insert(rows).getKnexQuery().toSQL();
  });

  bench('Drizzle', () => {
    drizzleDb.insert(drizzleUsers).values(rows).toSQL();
  });
});

describe('UPDATE — simple SET + WHERE', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.update(ctx, User, { $where: { id: 1 } }, { name: 'Updated', email: 'new@test.com' });
  });

  bench('Sequelize', () => {
    seqQg.updateQuery('User', { name: 'Updated', email: 'new@test.com' }, { id: 1 });
  });

  bench('TypeORM', () => {
    typeormDs
      .createQueryBuilder()
      .update('User')
      .set({ name: 'Updated', email: 'new@test.com' })
      .where('id = :id', { id: 1 })
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm
      .createQueryBuilder(MikroUserSchema)
      .update({ name: 'Updated', email: 'new@test.com' })
      .where({ id: 1 })
      .getKnexQuery()
      .toSQL();
  });

  bench('Drizzle', () => {
    drizzleDb
      .update(drizzleUsers)
      .set({ name: 'Updated', email: 'new@test.com' })
      .where(eq(drizzleUsers.id, 1))
      .toSQL();
  });
});
