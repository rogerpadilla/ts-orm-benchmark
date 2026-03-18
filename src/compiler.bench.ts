/**
 * TypeScript ORM SQL Generation Benchmark
 *
 * Measures pure SQL generation performance (no DB I/O) across:
 * - UQL         — Object-based queries, pre-computed metadata
 * - Sequelize   — Classic ORM, QueryGenerator API
 * - TypeORM     — EntitySchema + QueryBuilder
 * - MikroORM    — defineEntity + QueryBuilder (v7, no Knex)
 * - Drizzle     — Functional SQL builder
 * - Knex        — Standalone query builder
 * - Kysely      — Type-safe query builder
 *
 * Each entry defines the same User entity and compiles equivalent queries.
 * Run: npm run bench
 */

import { Entity, Field, Id } from 'uql-orm';
import { PostgresDialect as UqlDialect } from 'uql-orm/postgres';
import { beforeAll, bench, describe } from 'vitest';

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
sequelize.define(
  'User',
  {
    name: DataTypes.STRING,
    email: DataTypes.STRING,
    companyId: DataTypes.INTEGER,
    createdAt: DataTypes.INTEGER,
  },
  { timestamps: false, tableName: 'User', freezeTableName: true },
);

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
});

let typeormDs: DataSource;

// ── MikroORM ─────────────────────────────────────────────────────────────────
import { defineEntity, MikroORM, p as mikroP, raw } from '@mikro-orm/core';
import { defineConfig, type SqlEntityManager } from '@mikro-orm/sqlite';

interface MikroUser {
  id: number;
  name: string;
  email: string;
  companyId: number;
  createdAt: number;
}

const MikroUserSchema = defineEntity({
  // Keep the same table name (`User`) as the other benchmark entries.
  name: 'User',
  properties: {
    id: mikroP.integer().primary(),
    name: mikroP.string(),
    email: mikroP.string(),
    companyId: mikroP.integer(),
    createdAt: mikroP.integer(),
  },
});

class MikroUserEntity extends MikroUserSchema.class {}
MikroUserSchema.setClass(MikroUserEntity);

let mikroEm: SqlEntityManager;

// ── Drizzle ──────────────────────────────────────────────────────────────────
import { and, asc, desc, eq, gt, ilike, inArray, like, or, sql } from 'drizzle-orm';
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

// ── Knex ─────────────────────────────────────────────────────────────────────
import knexLib from 'knex';

const knexDb = knexLib({ client: 'pg', connection: {} });

// ── Kysely ────────────────────────────────────────────────────────────────────
import {
  DummyDriver,
  type Generated,
  Kysely,
  sql as kyselySql,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

interface KyselyDb {
  User: {
    id: Generated<number>;
    name: string;
    email: string;
    companyId: number;
    createdAt: number;
  };
}

const kyselyDb = new Kysely<KyselyDb>({
  dialect: {
    createDriver: () => new DummyDriver(),
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Global Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // TypeORM needs a DataSource for metadata (in-memory SQLite, no real DB)
  typeormDs = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [TypeORMUserSchema],
    synchronize: false,
    logging: false,
  });
  await typeormDs.initialize();

  // MikroORM needs an EntityManager (in-memory SQLite, no real DB)
  const orm = await MikroORM.init(
    defineConfig({
      dbName: ':memory:',
      entities: [MikroUserSchema],
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
    mikroEm.createQueryBuilder(MikroUserSchema).select(['name']).getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb.select({ name: drizzleUsers.name }).from(drizzleUsers).toSQL();
  });

  bench('Knex', () => {
    knexDb('User').select('name').toSQL();
  });

  bench('Kysely', () => {
    kyselyDb.selectFrom('User').select('name').compile();
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
      .getFormattedQuery();
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

  bench('Knex', () => {
    knexDb('User')
      .select('id', 'name')
      .where({ name: 'John' })
      .andWhere('companyId', '>', 5)
      .orderBy('name', 'asc')
      .limit(10)
      .offset(20)
      .toSQL();
  });

  bench('Kysely', () => {
    kyselyDb
      .selectFrom('User')
      .select(['id', 'name'])
      .where('name', '=', 'John')
      .where('companyId', '>', 5)
      .orderBy('name', 'asc')
      .limit(10)
      .offset(20)
      .compile();
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
      order: [
        ['createdAt', 'DESC'],
        ['name', 'ASC'],
      ],
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
          qb.where('User.name ILIKE :name1', { name1: '%john%' }).andWhere('User.companyId IN (:...companyIds)', {
            companyIds: [1, 2, 3],
          });
        }),
      )
      .orWhere(
        new Brackets((qb) => {
          qb.where('User.email LIKE :email', { email: '%@example.com' }).andWhere('User.createdAt > :createdAt', {
            createdAt: 1000,
          });
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
      .getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb
      .select({ id: drizzleUsers.id, name: drizzleUsers.name, email: drizzleUsers.email })
      .from(drizzleUsers)
      .where(
        or(
          and(ilike(drizzleUsers.name, '%john%'), inArray(drizzleUsers.companyId, [1, 2, 3])),
          and(like(drizzleUsers.email, '%@example.com'), gt(drizzleUsers.createdAt, 1000)),
        ),
      )
      .orderBy(desc(drizzleUsers.createdAt), asc(drizzleUsers.name))
      .limit(50)
      .toSQL();
  });

  bench('Knex', () => {
    knexDb('User')
      .select('id', 'name', 'email')
      .where((builder) => {
        builder
          .where((qb) => qb.whereILike('name', '%john%').whereIn('companyId', [1, 2, 3]))
          .orWhere((qb) => qb.whereLike('email', '%@example.com').where('createdAt', '>', 1000));
      })
      .orderBy([
        { column: 'createdAt', order: 'desc' },
        { column: 'name', order: 'asc' },
      ])
      .limit(50)
      .toSQL();
  });

  bench('Kysely', () => {
    kyselyDb
      .selectFrom('User')
      .select(['id', 'name', 'email'])
      .where((eb) =>
        eb.or([
          eb.and([eb('name', 'ilike', '%john%'), eb('companyId', 'in', [1, 2, 3])]),
          eb.and([eb('email', 'like', '%@example.com'), eb('createdAt', '>', 1000)]),
        ]),
      )
      .orderBy('createdAt', 'desc')
      .orderBy('name', 'asc')
      .limit(50)
      .compile();
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
    mikroEm.createQueryBuilder(MikroUserSchema).insert(rows).getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb.insert(drizzleUsers).values(rows).toSQL();
  });

  bench('Knex', () => {
    knexDb('User').insert(rows).toSQL();
  });

  bench('Kysely', () => {
    kyselyDb.insertInto('User').values(rows).compile();
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
      .getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb
      .update(drizzleUsers)
      .set({ name: 'Updated', email: 'new@test.com' })
      .where(eq(drizzleUsers.id, 1))
      .toSQL();
  });

  bench('Knex', () => {
    knexDb('User').update({ name: 'Updated', email: 'new@test.com' }).where({ id: 1 }).toSQL();
  });

  bench('Kysely', () => {
    kyselyDb.updateTable('User').set({ name: 'Updated', email: 'new@test.com' }).where('id', '=', 1).compile();
  });
});

describe('UPSERT — ON CONFLICT by id', () => {
  const row = { id: 1, name: 'Upserted', email: 'upsert@test.com', companyId: 10, createdAt: Date.now() };

  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.upsert(ctx, User, { id: true }, row);
  });

  bench('Sequelize', () => {
    seqQg.bulkInsertQuery('User', [row], {
      updateOnDuplicate: ['name', 'email', 'companyId', 'createdAt'],
      upsertKeys: ['id'],
    });
  });

  bench('TypeORM', () => {
    typeormDs
      .createQueryBuilder()
      .insert()
      .into('User')
      .values(row)
      .orUpdate(['name', 'email', 'companyId', 'createdAt'], ['id'])
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm.createQueryBuilder(MikroUserSchema).insert(row).onConflict('id').merge().getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb
      .insert(drizzleUsers)
      .values(row)
      .onConflictDoUpdate({
        target: drizzleUsers.id,
        set: { name: row.name, email: row.email, companyId: row.companyId, createdAt: row.createdAt },
      })
      .toSQL();
  });

  bench('Knex', () => {
    knexDb('User').insert(row).onConflict('id').merge().toSQL();
  });

  bench('Kysely', () => {
    kyselyDb
      .insertInto('User')
      .values(row)
      .onConflict((oc) =>
        oc
          .column('id')
          .doUpdateSet({ name: row.name, email: row.email, companyId: row.companyId, createdAt: row.createdAt }),
      )
      .compile();
  });
});

describe('DELETE — simple WHERE', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.delete(ctx, User, { $where: { id: 1 } });
  });

  bench('Sequelize', () => {
    seqQg.deleteQuery('User', { id: 1 });
  });

  bench('TypeORM', () => {
    typeormDs.createQueryBuilder().delete().from('User').where('id = :id', { id: 1 }).getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm.createQueryBuilder(MikroUserSchema).delete().where({ id: 1 }).getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb.delete(drizzleUsers).where(eq(drizzleUsers.id, 1)).toSQL();
  });

  bench('Knex', () => {
    knexDb('User').where({ id: 1 }).delete().toSQL();
  });

  bench('Kysely', () => {
    kyselyDb.deleteFrom('User').where('id', '=', 1).compile();
  });
});

// ── AGGREGATE — GROUP BY + COUNT + HAVING + SORT ─────────────────────────────
describe('AGGREGATE — GROUP BY + COUNT + HAVING', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.aggregate(ctx, User, {
      $group: {
        companyId: true,
        count: { $count: '*' },
        maxCreated: { $max: 'createdAt' },
      },
      $having: { count: { $gt: 5 } },
      $sort: { count: -1 },
      $limit: 10,
    });
  });

  bench('Sequelize', () => {
    seqQg.selectQuery('User', {
      attributes: [
        'companyId',
        [sequelize.fn('COUNT', sequelize.literal('*')), 'count'],
        [sequelize.fn('MAX', sequelize.col('createdAt')), 'maxCreated'],
      ],
      group: ['companyId'],
      having: sequelize.where(sequelize.fn('COUNT', sequelize.literal('*')), { [Op.gt]: 5 }),
      order: [[sequelize.fn('COUNT', sequelize.literal('*')), 'DESC']],
      limit: 10,
    });
  });

  bench('TypeORM', () => {
    typeormDs
      .createQueryBuilder()
      .select('User.companyId', 'companyId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(User.createdAt)', 'maxCreated')
      .from('User', 'User')
      .groupBy('User.companyId')
      .having('COUNT(*) > :minCount', { minCount: 5 })
      .orderBy('COUNT(*)', 'DESC')
      .limit(10)
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm
      .createQueryBuilder(MikroUserSchema)
      .select(['companyId'])
      .addSelect(raw('COUNT(*) as count'))
      .addSelect(raw('MAX(createdAt) as maxCreated'))
      .groupBy('companyId')
      .having('COUNT(*) > ?', [5])
      .orderBy({ [raw('COUNT(*)')]: 'DESC' })
      .limit(10)
      .getFormattedQuery();
  });

  bench('Drizzle', () => {
    drizzleDb
      .select({
        companyId: drizzleUsers.companyId,
        count: sql`COUNT(*)`,
        maxCreated: sql`MAX(${drizzleUsers.createdAt})`,
      })
      .from(drizzleUsers)
      .groupBy(drizzleUsers.companyId)
      .having(sql`COUNT(*) > 5`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10)
      .toSQL();
  });

  bench('Knex', () => {
    knexDb('User')
      .select('companyId')
      .count('* as count')
      .max('createdAt as maxCreated')
      .groupBy('companyId')
      .having(knexDb.raw('COUNT(*) > ?', [5]))
      .orderByRaw('COUNT(*) DESC')
      .limit(10)
      .toSQL();
  });

  bench('Kysely', () => {
    kyselyDb
      .selectFrom('User')
      .select(['companyId'])
      .select((eb) => eb.fn.countAll().as('count'))
      .select((eb) => eb.fn.max('createdAt').as('maxCreated'))
      .groupBy('companyId')
      .having(kyselySql`COUNT(*)`, '>', 5)
      .orderBy(kyselySql`COUNT(*)`, 'desc')
      .limit(10)
      .compile();
  });
});
