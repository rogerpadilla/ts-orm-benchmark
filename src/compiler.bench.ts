/**
 * TypeScript ORM SQL Generation Benchmark
 *
 * Measures pure SQL generation performance (no DB I/O) across:
 * - UQL         — Object-based queries, pre-computed metadata
 * - Sequelize   — Classic ORM, QueryGenerator API
 * - TypeORM     — EntitySchema + QueryBuilder
 * - MikroORM    — defineEntity + QueryBuilder (v7, Kysely-based internally)
 * - Drizzle     — Functional SQL builder
 * - Knex        — Standalone query builder
 * - Kysely      — Type-safe query builder
 *
 * Each entry defines the same User entity and compiles equivalent queries.
 * Run: npm run bench
 */

import { PostgresDialect as UqlDialect } from 'uql-orm/postgres';
import { beforeAll, bench, describe } from 'vitest';
import {
  COMPANY_TABLE,
  defineSequelizeModels,
  drizzleCompanies,
  drizzleUsers,
  type KyselyDb,
  MikroCompanySchema,
  MikroUserSchema,
  TypeORMCompanySchema,
  TypeORMUserSchema,
  USER_TABLE,
  User,
} from './schema';

const uqlDialect = new UqlDialect();

// ── Sequelize ────────────────────────────────────────────────────────────────
import { Op, Sequelize } from 'sequelize';

const sequelize = new Sequelize('postgres://x:x@localhost/x', { logging: false, dialect: 'postgres' });
defineSequelizeModels(sequelize);

const seqQg = sequelize.getQueryInterface().queryGenerator as any;

// ── TypeORM ──────────────────────────────────────────────────────────────────
import { Brackets, DataSource } from 'typeorm';

// minimal `pg` stub so DataSource.initialize() works offline (answers the three startup queries)
const pgStub = {
  Pool: class {
    on() {}
    connect(cb: (err: null, connection: unknown, release: () => void) => void) {
      const connection = {
        on() {},
        once() {},
        removeListener() {},
        query(text: string) {
          if (text.includes('version()')) return Promise.resolve({ rows: [{ version: 'PostgreSQL 17.5' }] });
          if (text.includes('current_database()')) return Promise.resolve({ rows: [{ current_database: 'bench' }] });
          if (text.includes('current_schema()')) return Promise.resolve({ rows: [{ current_schema: 'public' }] });
          return Promise.resolve({ rows: [] });
        },
      };
      cb(null, connection, () => {});
    }
    end(cb: (err?: Error) => void) {
      cb();
    }
  },
};

let typeormDs: DataSource;

// ── MikroORM ─────────────────────────────────────────────────────────────────
import { EntityCaseNamingStrategy, MikroORM, raw } from '@mikro-orm/core';
import { defineConfig, type SqlEntityManager } from '@mikro-orm/postgresql';

let mikroEm: SqlEntityManager;

// ── Drizzle ──────────────────────────────────────────────────────────────────
import { and, asc, desc, eq, gt, ilike, inArray, like, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

const drizzleDb = drizzle({ client: { connect: () => ({}) } as any });

// ── Knex ─────────────────────────────────────────────────────────────────────
import knexLib from 'knex';

const knexDb = knexLib({ client: 'pg', connection: {} });

// ── Kysely ────────────────────────────────────────────────────────────────────
import {
  DummyDriver,
  Kysely,
  sql as kyselySql,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

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
  // TypeORM needs an initialized DataSource for metadata; the pg stub avoids a real DB
  typeormDs = new DataSource({
    type: 'postgres',
    driver: pgStub,
    database: 'bench',
    entities: [TypeORMCompanySchema, TypeORMUserSchema],
    synchronize: false,
    logging: false,
    installExtensions: false,
  });
  await typeormDs.initialize();

  // MikroORM v7 `init()` discovers metadata without connecting (no real DB needed)
  const orm = await MikroORM.init(
    defineConfig({
      dbName: 'bench',
      entities: [MikroCompanySchema, MikroUserSchema],
      // keep the same identifiers ("User", "companyId") as the other entries
      namingStrategy: EntityCaseNamingStrategy,
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
    mikroEm.createQueryBuilder(MikroUserSchema).select(['name']).toQuery();
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
      .where({ name: 'John', company: { $gt: 5 } })
      .orderBy({ name: 'ASC' })
      .limit(10)
      .offset(20)
      .toQuery();
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
          { name: { $ilike: '%john%' }, company: { $in: [1, 2, 3] } },
          { email: { $like: '%@example.com' }, createdAt: { $gt: 1000 } },
        ],
      })
      .orderBy({ createdAt: 'DESC', name: 'ASC' })
      .limit(50)
      .toQuery();
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

  // MikroORM's model has no scalar `companyId` (see `src/schema.ts`), so it names the relation instead.
  // Keys stay in the same order because MikroORM derives column order from the payload, and the point
  // is to compile the identical statement the other six do.
  const mikroRows = rows.map((r) => ({
    name: r.name,
    email: r.email,
    company: r.companyId,
    createdAt: r.createdAt,
  }));

  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.insert<User>(ctx, User, rows);
  });

  bench('Sequelize', () => {
    seqQg.bulkInsertQuery('User', rows);
  });

  bench('TypeORM', () => {
    typeormDs.createQueryBuilder().insert().into('User').values(rows).getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm.createQueryBuilder(MikroUserSchema).insert(mikroRows).toQuery();
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
      .toQuery();
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
  const mikroRow = {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.companyId,
    createdAt: row.createdAt,
  };

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
      // Columns stated explicitly: `id` is `generated: true`, so without this TypeORM omits it from the
      // INSERT and `ON CONFLICT ("id")` can never fire, making this a plain insert of a new row while
      // the other six genuinely upsert.
      .into('User', ['id', 'name', 'email', 'companyId', 'createdAt'])
      .values(row)
      .orUpdate(['name', 'email', 'companyId', 'createdAt'], ['id'])
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm.createQueryBuilder(MikroUserSchema).insert(mikroRow).onConflict('id').merge().toQuery();
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
    mikroEm.createQueryBuilder(MikroUserSchema).delete().where({ id: 1 }).toQuery();
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
      $group: { companyId: true },
      $agg: {
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
      .select(['company'])
      .addSelect(raw('COUNT(*) as count'))
      .addSelect(raw('MAX(createdAt) as maxCreated'))
      .groupBy('company')
      .having('COUNT(*) > ?', [5])
      .orderBy({ [raw('COUNT(*)')]: 'DESC' })
      .limit(10)
      .toQuery();
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

// ── SELECT — populate (many-to-one JOIN) ─────────────────────────────────────
// Many-to-one, not one-to-many, because that is the direction every entry compiles as a single JOIN.
// UQL populates a to-many with a second `IN (parent ids)` query rather than a join (see
// `fillToManyRelations` in uql-orm), and Drizzle uses a `LEFT JOIN LATERAL ... json_agg`, so a
// one-to-many case here would compare a root query against two different join strategies. That
// difference is worth measuring end-to-end, which is what the flow benchmark does.
describe('SELECT — populate (m:1 JOIN)', () => {
  bench('UQL', () => {
    const ctx = uqlDialect.createContext();
    uqlDialect.find(ctx, User, {
      $select: { id: true, name: true },
      $populate: { company: { $select: { id: true, name: true } } },
      $limit: 50,
    });
  });

  // Sequelize is absent: its `include` never reaches SQL without executing. `QueryGenerator.selectQuery`
  // throws on an include, and conforming one via `_conformIncludes`/`_validateIncludedElements` throws
  // too, because joins are assembled inside `Model.findAll`. It is measured in the flow benchmark, where
  // executing is the point.

  bench('TypeORM', () => {
    typeormDs
      .createQueryBuilder(TypeORMUserSchema, 'User')
      .select(['User.id', 'User.name'])
      .leftJoinAndSelect('User.company', 'company')
      .limit(50)
      .getQueryAndParameters();
  });

  bench('MikroORM', () => {
    mikroEm
      .createQueryBuilder(MikroUserSchema, 'u')
      .select(['id', 'name'])
      .leftJoinAndSelect('u.company', 'c')
      .limit(50)
      .toQuery();
  });

  bench('Drizzle', () => {
    drizzleDb
      .select({
        id: drizzleUsers.id,
        name: drizzleUsers.name,
        companyId: drizzleCompanies.id,
        companyName: drizzleCompanies.name,
      })
      .from(drizzleUsers)
      .leftJoin(drizzleCompanies, eq(drizzleUsers.companyId, drizzleCompanies.id))
      .limit(50)
      .toSQL();
  });

  bench('Knex', () => {
    knexDb(USER_TABLE)
      .select(
        `${USER_TABLE}.id`,
        `${USER_TABLE}.name`,
        `${COMPANY_TABLE}.id as companyId`,
        `${COMPANY_TABLE}.name as companyName`,
      )
      .leftJoin(COMPANY_TABLE, `${USER_TABLE}.companyId`, `${COMPANY_TABLE}.id`)
      .limit(50)
      .toSQL();
  });

  bench('Kysely', () => {
    kyselyDb
      .selectFrom('User')
      .leftJoin('Company', 'Company.id', 'User.companyId')
      .select(['User.id', 'User.name', 'Company.id as companyId', 'Company.name as companyName'])
      .limit(50)
      .compile();
  });
});
