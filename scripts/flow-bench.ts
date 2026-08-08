/**
 * Real-database flow benchmark.
 *
 * `compiler.bench.ts` measures SQL *generation*. This measures the rest of what an ORM costs per
 * request: the round trip, turning driver rows back into objects, and assembling nested relations. It
 * runs a lifecycle (insert, read, update, read, nested read, delete, read) so each read verifies the
 * write before it, which means a step that silently does nothing fails instead of scoring well.
 *
 * Reported in µs per operation, lower is better, alongside a raw `pg` baseline. The baseline is the
 * point: absolute latency swings with how you reach Postgres, but the gap above raw `pg` is the ORM's
 * own overhead and is comparable across setups.
 *
 * Usage:
 *   DATABASE_URL=postgres:///postgres bun scripts/flow-bench.ts
 *   bun scripts/flow-bench.ts --iterations 400
 *   bun scripts/flow-bench.ts --iterations 3 --verify   # assert every step, write nothing
 */

import { asc, eq, gt } from 'drizzle-orm';
import pg from 'pg';
import { Op } from 'sequelize';
import { LessThanOrEqual, MoreThan } from 'typeorm';
import { type Clients, createClients } from '../src/clients';
import {
  COMPANY_TABLE,
  Company,
  drizzleUsers,
  MikroCompanySchema,
  MikroUserSchema,
  SEED_COMPANIES,
  SEED_USERS,
  TABLE_DDL,
  TypeORMUserSchema,
  USER_TABLE,
  User,
} from '../src/schema';
import {
  FLOW_ENTRIES,
  FLOW_STEPS,
  type FlowEntry,
  type FlowStep,
  flowDataset,
  mergeDataset,
  type Series,
  syncResultsArtifacts,
} from './bench-common.js';

const BENCH_DB = 'ts_orm_bench';

type Step = { run: () => Promise<unknown>; check: (returned: unknown) => void };
type Flow = Record<FlowStep, Step>;

/** The 10 rows every entry inserts. Ids are left to the sequence so the insert is a real insert. */
const NEW_USERS = Array.from({ length: 10 }, (_, i) => ({
  name: `New User ${i}`,
  email: `new${i}@example.com`,
  companyId: (i % SEED_COMPANIES.length) + 1,
  createdAt: 2_000_000 + i,
}));

const READ_LIMIT = 200;
const NESTED_LIMIT = 50;
const UPDATE_NAME = 'Updated Name';

function expect(cond: boolean, message: string) {
  if (!cond) {
    throw new Error(`flow assertion failed: ${message}`);
  }
}

/** Rows come back with different key casing and numeric types per driver; only the shape is asserted. */
function rowCount(returned: unknown): number {
  return Array.isArray(returned) ? returned.length : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-entry flows
// ─────────────────────────────────────────────────────────────────────────────

/** Knex and Kysely have no relation loading, so the nested step is the grouping a user would write. */
function nestFlatRows(rows: { cId: number; cName: string; uId: number | null; uName: string | null }[]) {
  const byId = new Map<number, { id: number; name: string; users: { id: number; name: string }[] }>();
  for (const row of rows) {
    let parent = byId.get(row.cId);
    if (!parent) {
      parent = { id: row.cId, name: row.cName, users: [] };
      byId.set(row.cId, parent);
    }
    if (row.uId !== null) {
      parent.users.push({ id: row.uId, name: row.uName as string });
    }
  }
  return [...byId.values()];
}

function rawPgFlow(c: Clients): Flow {
  const db = c.rawPg;
  // Hoisted: the statement is constant, so a hand-written implementation would build it once. Leaving the
  // template concatenation inside the timer made the baseline slower than Kysely, which would have made
  // every "overhead over raw pg" figure understate the real gap.
  const insertSql = `INSERT INTO "${USER_TABLE}" (name,email,"companyId","createdAt") VALUES ${NEW_USERS.map(
    (_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`,
  ).join(',')} RETURNING id`;
  const insertParams = NEW_USERS.flatMap((u) => [u.name, u.email, u.companyId, u.createdAt]);
  return {
    insert: {
      run: async () => (await db.query(insertSql, insertParams)).rows,
      check: (r) => expect(rowCount(r) === 10, 'raw pg insert returned 10 ids'),
    },
    read: {
      run: async () =>
        (
          await db.query(
            `SELECT id,name,email,"companyId","createdAt" FROM "${USER_TABLE}" WHERE "companyId" > $1 ORDER BY id LIMIT $2`,
            [0, READ_LIMIT],
          )
        ).rows,
      check: (r) => expect(rowCount(r) === READ_LIMIT, `raw pg read returned ${READ_LIMIT}`),
    },
    update: {
      run: async () =>
        (await db.query(`UPDATE "${USER_TABLE}" SET name=$1 WHERE id=$2 RETURNING id`, [UPDATE_NAME, 1])).rows,
      check: (r) => expect(rowCount(r) === 1, 'raw pg update touched 1 row'),
    },
    readAgain: {
      run: async () => (await db.query(`SELECT id,name FROM "${USER_TABLE}" WHERE id=$1`, [1])).rows,
      check: (r) => {
        const rows = r as { name: string }[];
        expect(rows[0]?.name === UPDATE_NAME, 'raw pg sees the updated name');
      },
    },
    nested: {
      run: async () => {
        const rows = (
          await db.query(
            `SELECT c.id "cId", c.name "cName", u.id "uId", u.name "uName"
             FROM "${COMPANY_TABLE}" c LEFT JOIN "${USER_TABLE}" u ON u."companyId" = c.id
             WHERE c.id <= $1 ORDER BY c.id`,
            [NESTED_LIMIT],
          )
        ).rows as { cId: number; cName: string; uId: number | null; uName: string | null }[];
        const byId = new Map<number, { id: number; name: string; users: { id: number; name: string }[] }>();
        for (const row of rows) {
          let parent = byId.get(row.cId);
          if (!parent) {
            parent = { id: row.cId, name: row.cName, users: [] };
            byId.set(row.cId, parent);
          }
          if (row.uId !== null) {
            parent.users.push({ id: row.uId, name: row.uName as string });
          }
        }
        return [...byId.values()];
      },
      check: (r) => {
        const cs = r as { users: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `raw pg nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => x.users.length > 0),
          'raw pg nested populated users',
        );
      },
    },
    delete: {
      run: async () => (await db.query(`DELETE FROM "${USER_TABLE}" WHERE id=$1 RETURNING id`, [1])).rows,
      check: (r) => expect(rowCount(r) === 1, 'raw pg delete removed 1 row'),
    },
    readEmpty: {
      run: async () => (await db.query(`SELECT id FROM "${USER_TABLE}" WHERE id=$1`, [1])).rows,
      check: (r) => expect(rowCount(r) === 0, 'raw pg sees the row gone'),
    },
  };
}

function bunSqlFlow(c: Clients): Flow {
  const sql = c.bunSql;
  return {
    insert: {
      // Bun expands an array of objects into the column list and the VALUES tuples itself.
      run: () => sql`INSERT INTO "User" ${sql(NEW_USERS)} RETURNING id`,
      check: (r) => expect(rowCount(r) === 10, 'bun sql insert returned 10 ids'),
    },
    read: {
      run: () =>
        sql`SELECT id,name,email,"companyId","createdAt" FROM "User" WHERE "companyId" > 0 ORDER BY id LIMIT ${READ_LIMIT}`,
      check: (r) => expect(rowCount(r) === READ_LIMIT, `bun sql read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => sql`UPDATE "User" SET name=${UPDATE_NAME} WHERE id=1 RETURNING id`,
      check: (r) => expect(rowCount(r) === 1, 'bun sql update touched 1 row'),
    },
    readAgain: {
      run: () => sql`SELECT id,name FROM "User" WHERE id=1`,
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'bun sql sees the updated name'),
    },
    nested: {
      run: async () => {
        const rows = (await sql`
          SELECT c.id AS "cId", c.name AS "cName", u.id AS "uId", u.name AS "uName"
          FROM "Company" c LEFT JOIN "User" u ON u."companyId" = c.id
          WHERE c.id <= ${NESTED_LIMIT} ORDER BY c.id
        `) as unknown as { cId: number; cName: string; uId: number | null; uName: string | null }[];
        return nestFlatRows(rows);
      },
      check: (r) => {
        const cs = r as { users: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `bun sql nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => x.users.length > 0),
          'bun sql nested populated users',
        );
      },
    },
    delete: {
      run: () => sql`DELETE FROM "User" WHERE id=1 RETURNING id`,
      check: (r) => expect(rowCount(r) === 1, 'bun sql delete removed 1 row'),
    },
    readEmpty: {
      run: () => sql`SELECT id FROM "User" WHERE id=1`,
      check: (r) => expect(rowCount(r) === 0, 'bun sql sees the row gone'),
    },
  };
}

function uqlFlow(c: Clients, q: Clients['uql'] | Clients['uqlBunSql'] = c.uql): Flow {
  return {
    insert: {
      run: () => q.insertMany<User>(User, NEW_USERS),
      check: (r) => expect(rowCount(r) === 10, 'UQL insert returned 10 ids'),
    },
    read: {
      run: () =>
        q.findMany(User, {
          $select: { id: true, name: true, email: true, companyId: true, createdAt: true },
          $where: { companyId: { $gt: 0 } },
          $sort: { id: 1 },
          $limit: READ_LIMIT,
        }),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `UQL read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => q.updateMany(User, { $where: { id: 1 } }, { name: UPDATE_NAME }),
      check: (r) => expect(Number(r) === 1, 'UQL update touched 1 row'),
    },
    readAgain: {
      run: () => q.findMany(User, { $select: { id: true, name: true }, $where: { id: 1 } }),
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'UQL sees the updated name'),
    },
    nested: {
      run: () =>
        q.findMany(Company, {
          $select: { id: true, name: true },
          $populate: { users: { $select: { id: true, name: true } } },
          $where: { id: { $lte: NESTED_LIMIT } },
          $sort: { id: 1 },
        }),
      check: (r) => {
        const cs = r as { users?: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `UQL nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => (x.users?.length ?? 0) > 0),
          'UQL nested populated users',
        );
      },
    },
    delete: {
      run: () => q.deleteMany(User, { $where: { id: 1 } }),
      check: (r) => expect(Number(r) === 1, 'UQL delete removed 1 row'),
    },
    readEmpty: {
      run: () => q.findMany(User, { $select: { id: true }, $where: { id: 1 } }),
      check: (r) => expect(rowCount(r) === 0, 'UQL sees the row gone'),
    },
  };
}

function sequelizeFlow(c: Clients): Flow {
  const { SqUser, SqCompany } = c;
  return {
    insert: {
      run: () => SqUser.bulkCreate(NEW_USERS as never[]),
      check: (r) => expect(rowCount(r) === 10, 'Sequelize insert created 10'),
    },
    read: {
      run: () =>
        SqUser.findAll({
          attributes: ['id', 'name', 'email', 'companyId', 'createdAt'],
          where: { companyId: { [Op.gt]: 0 } },
          order: [['id', 'ASC']],
          limit: READ_LIMIT,
        }),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `Sequelize read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => SqUser.update({ name: UPDATE_NAME }, { where: { id: 1 } }),
      check: (r) => expect((r as number[])[0] === 1, 'Sequelize update touched 1 row'),
    },
    readAgain: {
      run: () => SqUser.findAll({ attributes: ['id', 'name'], where: { id: 1 } }),
      check: (r) =>
        expect((r as { get(k: string): unknown }[])[0]?.get('name') === UPDATE_NAME, 'Sequelize sees updated name'),
    },
    nested: {
      run: () =>
        SqCompany.findAll({
          attributes: ['id', 'name'],
          include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
          where: { id: { [Op.lte]: NESTED_LIMIT } },
          order: [['id', 'ASC']],
        }),
      check: (r) => {
        const cs = r as { get(k: string): unknown }[];
        expect(cs.length === NESTED_LIMIT, `Sequelize nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => (x.get('users') as unknown[])?.length > 0),
          'Sequelize nested populated users',
        );
      },
    },
    delete: {
      run: () => SqUser.destroy({ where: { id: 1 } }),
      check: (r) => expect(Number(r) === 1, 'Sequelize delete removed 1 row'),
    },
    readEmpty: {
      run: () => SqUser.findAll({ attributes: ['id'], where: { id: 1 } }),
      check: (r) => expect(rowCount(r) === 0, 'Sequelize sees the row gone'),
    },
  };
}

function typeormFlow(c: Clients): Flow {
  const ds = c.typeorm;
  const repo = ds.getRepository(TypeORMUserSchema);
  const companies = ds.getRepository('Company');
  return {
    insert: {
      run: () => repo.insert(NEW_USERS as never),
      check: (r) => expect(rowCount((r as { identifiers: unknown[] }).identifiers) === 10, 'TypeORM inserted 10'),
    },
    read: {
      run: () =>
        repo.find({
          select: { id: true, name: true, email: true, companyId: true, createdAt: true },
          where: { companyId: MoreThan(0) },
          order: { id: 'ASC' },
          take: READ_LIMIT,
        }),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `TypeORM read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => repo.update({ id: 1 }, { name: UPDATE_NAME }),
      check: (r) => expect((r as { affected?: number }).affected === 1, 'TypeORM update touched 1 row'),
    },
    readAgain: {
      run: () => repo.find({ select: { id: true, name: true }, where: { id: 1 } }),
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'TypeORM sees updated name'),
    },
    nested: {
      run: () =>
        companies.find({
          select: { id: true, name: true },
          relations: { users: true },
          where: { id: LessThanOrEqual(NESTED_LIMIT) },
          order: { id: 'ASC' },
        }),
      check: (r) => {
        const cs = r as { users?: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `TypeORM nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => (x.users?.length ?? 0) > 0),
          'TypeORM nested populated users',
        );
      },
    },
    delete: {
      run: () => repo.delete({ id: 1 }),
      check: (r) => expect((r as { affected?: number }).affected === 1, 'TypeORM delete removed 1 row'),
    },
    readEmpty: {
      run: () => repo.find({ select: { id: true }, where: { id: 1 } }),
      check: (r) => expect(rowCount(r) === 0, 'TypeORM sees the row gone'),
    },
  };
}

function mikroFlow(c: Clients): Flow {
  const em = c.mikroEm;
  const mikroNew = NEW_USERS.map((u) => ({
    name: u.name,
    email: u.email,
    company: u.companyId,
    createdAt: u.createdAt,
  }));
  return {
    insert: {
      run: () => em.createQueryBuilder(MikroUserSchema).insert(mikroNew).execute(),
      check: () => undefined,
    },
    read: {
      run: () =>
        em
          .createQueryBuilder(MikroUserSchema)
          .select(['id', 'name', 'email', 'company', 'createdAt'])
          .where({ company: { $gt: 0 } })
          .orderBy({ id: 'ASC' })
          .limit(READ_LIMIT)
          .getResult(),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `MikroORM read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => em.createQueryBuilder(MikroUserSchema).update({ name: UPDATE_NAME }).where({ id: 1 }).execute(),
      check: () => undefined,
    },
    readAgain: {
      run: () => em.createQueryBuilder(MikroUserSchema).select(['id', 'name']).where({ id: 1 }).getResult(),
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'MikroORM sees updated name'),
    },
    nested: {
      run: () =>
        em
          .fork()
          .find(
            MikroCompanySchema,
            { id: { $lte: NESTED_LIMIT } },
            { fields: ['id', 'name', 'users.id', 'users.name'], populate: ['users'], orderBy: { id: 'ASC' } },
          ),
      check: (r) => {
        const cs = r as { users?: { length: number } }[];
        expect(cs.length === NESTED_LIMIT, `MikroORM nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => (x.users?.length ?? 0) > 0),
          'MikroORM nested populated users',
        );
      },
    },
    delete: {
      run: () => em.createQueryBuilder(MikroUserSchema).delete().where({ id: 1 }).execute(),
      check: () => undefined,
    },
    readEmpty: {
      run: () => em.createQueryBuilder(MikroUserSchema).select(['id']).where({ id: 1 }).getResult(),
      check: (r) => expect(rowCount(r) === 0, 'MikroORM sees the row gone'),
    },
  };
}

function drizzleFlow(c: Clients, db: Clients['drizzleDb'] = c.drizzleDb): Flow {
  return {
    insert: {
      run: () => db.insert(drizzleUsers).values(NEW_USERS).returning({ id: drizzleUsers.id }),
      check: (r) => expect(rowCount(r) === 10, 'Drizzle inserted 10'),
    },
    read: {
      run: () =>
        db
          .select({
            id: drizzleUsers.id,
            name: drizzleUsers.name,
            email: drizzleUsers.email,
            companyId: drizzleUsers.companyId,
            createdAt: drizzleUsers.createdAt,
          })
          .from(drizzleUsers)
          .where(gt(drizzleUsers.companyId, 0))
          .orderBy(asc(drizzleUsers.id))
          .limit(READ_LIMIT),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `Drizzle read returned ${READ_LIMIT}`),
    },
    update: {
      run: () =>
        db
          .update(drizzleUsers)
          .set({ name: UPDATE_NAME })
          .where(eq(drizzleUsers.id, 1))
          .returning({ id: drizzleUsers.id }),
      check: (r) => expect(rowCount(r) === 1, 'Drizzle update touched 1 row'),
    },
    readAgain: {
      run: () =>
        db.select({ id: drizzleUsers.id, name: drizzleUsers.name }).from(drizzleUsers).where(eq(drizzleUsers.id, 1)),
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'Drizzle sees updated name'),
    },
    nested: {
      run: () =>
        db.query.Company.findMany({
          columns: { id: true, name: true },
          with: { users: { columns: { id: true, name: true } } },
          where: (t, { lte }) => lte(t.id, NESTED_LIMIT),
          orderBy: (t, { asc: a }) => a(t.id),
        }),
      check: (r) => {
        const cs = r as { users: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `Drizzle nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => x.users.length > 0),
          'Drizzle nested populated users',
        );
      },
    },
    delete: {
      run: () => db.delete(drizzleUsers).where(eq(drizzleUsers.id, 1)).returning({ id: drizzleUsers.id }),
      check: (r) => expect(rowCount(r) === 1, 'Drizzle delete removed 1 row'),
    },
    readEmpty: {
      run: () => db.select({ id: drizzleUsers.id }).from(drizzleUsers).where(eq(drizzleUsers.id, 1)),
      check: (r) => expect(rowCount(r) === 0, 'Drizzle sees the row gone'),
    },
  };
}

function knexFlow(c: Clients): Flow {
  const db = c.knexDb;
  return {
    insert: {
      run: () => db(USER_TABLE).insert(NEW_USERS).returning('id'),
      check: (r) => expect(rowCount(r) === 10, 'Knex inserted 10'),
    },
    read: {
      run: () =>
        db(USER_TABLE)
          .select('id', 'name', 'email', 'companyId', 'createdAt')
          .where('companyId', '>', 0)
          .orderBy('id', 'asc')
          .limit(READ_LIMIT),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `Knex read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => db(USER_TABLE).where({ id: 1 }).update({ name: UPDATE_NAME }).returning('id'),
      check: (r) => expect(rowCount(r) === 1, 'Knex update touched 1 row'),
    },
    readAgain: {
      run: () => db(USER_TABLE).select('id', 'name').where({ id: 1 }),
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'Knex sees updated name'),
    },
    nested: {
      run: async () => {
        const rows = (await db(COMPANY_TABLE)
          .leftJoin(USER_TABLE, `${USER_TABLE}.companyId`, `${COMPANY_TABLE}.id`)
          .where(`${COMPANY_TABLE}.id`, '<=', NESTED_LIMIT)
          .orderBy(`${COMPANY_TABLE}.id`, 'asc')
          .select(
            `${COMPANY_TABLE}.id as cId`,
            `${COMPANY_TABLE}.name as cName`,
            `${USER_TABLE}.id as uId`,
            `${USER_TABLE}.name as uName`,
          )) as { cId: number; cName: string; uId: number | null; uName: string | null }[];
        return nestFlatRows(rows);
      },
      check: (r) => {
        const cs = r as { users: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `Knex nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => x.users.length > 0),
          'Knex nested populated users',
        );
      },
    },
    delete: {
      run: () => db(USER_TABLE).where({ id: 1 }).delete().returning('id'),
      check: (r) => expect(rowCount(r) === 1, 'Knex delete removed 1 row'),
    },
    readEmpty: {
      run: () => db(USER_TABLE).select('id').where({ id: 1 }),
      check: (r) => expect(rowCount(r) === 0, 'Knex sees the row gone'),
    },
  };
}

function kyselyFlow(c: Clients): Flow {
  const db = c.kyselyDb;
  return {
    insert: {
      run: () => db.insertInto('User').values(NEW_USERS).returning('id').execute(),
      check: (r) => expect(rowCount(r) === 10, 'Kysely inserted 10'),
    },
    read: {
      run: () =>
        db
          .selectFrom('User')
          .select(['id', 'name', 'email', 'companyId', 'createdAt'])
          .where('companyId', '>', 0)
          .orderBy('id', 'asc')
          .limit(READ_LIMIT)
          .execute(),
      check: (r) => expect(rowCount(r) === READ_LIMIT, `Kysely read returned ${READ_LIMIT}`),
    },
    update: {
      run: () => db.updateTable('User').set({ name: UPDATE_NAME }).where('id', '=', 1).returning('id').execute(),
      check: (r) => expect(rowCount(r) === 1, 'Kysely update touched 1 row'),
    },
    readAgain: {
      run: () => db.selectFrom('User').select(['id', 'name']).where('id', '=', 1).execute(),
      check: (r) => expect((r as { name: string }[])[0]?.name === UPDATE_NAME, 'Kysely sees updated name'),
    },
    nested: {
      run: async () => {
        const rows = (await db
          .selectFrom('Company')
          .leftJoin('User', 'User.companyId', 'Company.id')
          .where('Company.id', '<=', NESTED_LIMIT)
          .orderBy('Company.id', 'asc')
          .select(['Company.id as cId', 'Company.name as cName', 'User.id as uId', 'User.name as uName'])
          .execute()) as unknown as { cId: number; cName: string; uId: number | null; uName: string | null }[];
        return nestFlatRows(rows);
      },
      check: (r) => {
        const cs = r as { users: unknown[] }[];
        expect(cs.length === NESTED_LIMIT, `Kysely nested returned ${NESTED_LIMIT} companies`);
        expect(
          cs.every((x) => x.users.length > 0),
          'Kysely nested populated users',
        );
      },
    },
    delete: {
      run: () => db.deleteFrom('User').where('id', '=', 1).returning('id').execute(),
      check: (r) => expect(rowCount(r) === 1, 'Kysely delete removed 1 row'),
    },
    readEmpty: {
      run: () => db.selectFrom('User').select('id').where('id', '=', 1).execute(),
      check: (r) => expect(rowCount(r) === 0, 'Kysely sees the row gone'),
    },
  };
}

const FLOWS: Record<FlowEntry, (c: Clients) => Flow> = {
  'raw pg': rawPgFlow,
  'bun sql': bunSqlFlow,
  UQL: uqlFlow,
  'UQL (bunSql)': (c) => uqlFlow(c, c.uqlBunSql),
  Sequelize: sequelizeFlow,
  TypeORM: typeormFlow,
  MikroORM: mikroFlow,
  Drizzle: drizzleFlow,
  // Same query-building API, different driver; the two db types are structurally distinct only in their
  // driver internals, which the flow never touches.
  'Drizzle (bunSql)': (c) => drizzleFlow(c, c.drizzleBunDb as unknown as Clients['drizzleDb']),
  Knex: knexFlow,
  Kysely: kyselyFlow,
};

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

/** Median, not mean: one GC pause during a run would otherwise dominate the number. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function resetFixture(admin: pg.Pool) {
  await admin.query(`TRUNCATE "${USER_TABLE}", "${COMPANY_TABLE}" RESTART IDENTITY CASCADE`);
  await admin.query(`INSERT INTO "${COMPANY_TABLE}" (id, name) SELECT * FROM UNNEST($1::int[], $2::text[])`, [
    SEED_COMPANIES.map((x) => x.id),
    SEED_COMPANIES.map((x) => x.name),
  ]);
  await admin.query(
    `INSERT INTO "${USER_TABLE}" (id, name, email, "companyId", "createdAt")
     SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::int[], $5::int[])`,
    [
      SEED_USERS.map((x) => x.id),
      SEED_USERS.map((x) => x.name),
      SEED_USERS.map((x) => x.email),
      SEED_USERS.map((x) => x.companyId),
      SEED_USERS.map((x) => x.createdAt),
    ],
  );
  for (const t of [COMPANY_TABLE, USER_TABLE]) {
    await admin.query(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), (SELECT MAX(id) FROM "${t}"))`);
  }
}

async function ensureDatabase(baseUrl: string): Promise<string> {
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [BENCH_DB]);
  if (exists.rowCount === 0) {
    // Its own database, never the one DATABASE_URL points at: the fixture reset truncates tables.
    await admin.query(`CREATE DATABASE "${BENCH_DB}"`);
  }
  await admin.end();

  const url = new URL(baseUrl);
  url.pathname = `/${BENCH_DB}`;
  const benchUrl = url.toString();

  const bench = new pg.Pool({ connectionString: benchUrl, max: 1 });
  await bench.query(`DROP TABLE IF EXISTS "${USER_TABLE}", "${COMPANY_TABLE}"`);
  for (const ddl of TABLE_DDL) {
    await bench.query(ddl);
  }
  await bench.end();
  return benchUrl;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const baseUrl = process.env.DATABASE_URL ?? 'postgres://localhost:5432/postgres';
  const iterations = Number(arg('iterations', '250'));
  // CI runs a handful of iterations purely to exercise every step's assertions, where the timings are
  // meaningless and must not reach the published artifacts.
  const verifyOnly = process.argv.includes('--verify');
  // Generous warmup even though the entries are interleaved: an earlier 12-iteration warmup left Knex's
  // overhead swinging between +156µs and +886µs across runs.
  const warmup = Math.max(40, Math.round(iterations / 2));

  console.log(`flow benchmark: ${iterations} iterations/step, ${warmup} warmup`);
  const benchUrl = await ensureDatabase(baseUrl);
  const admin = new pg.Pool({ connectionString: benchUrl, max: 1 });
  const version = (await admin.query('SELECT version()')).rows[0].version as string;
  console.log(version.split(' on ')[0], '\n');

  const clients = await createClients(benchUrl);
  // Built once. Some flows hoist a constant statement out of the timed section, which only holds if the
  // flow itself is not rebuilt per iteration.
  const flows = FLOW_ENTRIES.map((entry) => FLOWS[entry](clients));
  const samples = FLOW_ENTRIES.map(
    () => Object.fromEntries(FLOW_STEPS.map((s) => [s, [] as number[]])) as Record<FlowStep, number[]>,
  );
  const rounds = warmup + iterations;

  try {
    for (let round = 0; round < rounds; round++) {
      // Entries are interleaved one pass at a time, and rotated so each spends an equal share of its
      // samples in every position. Running each entry to completion instead made the result depend on
      // declaration order: the first absorbed process-wide JIT warmup, and later ones ran against a
      // bigger heap. That is what made `UQL (bunSql)` look slower than `UQL` when measuring it on its own
      // shows it 1.20x faster. Spreading each entry's samples across the whole session is also why this
      // needs no averaging over repeated runs, which the generation bench does only because tinybench
      // keeps its state per process.
      for (let k = 0; k < flows.length; k++) {
        const i = (k + round) % flows.length;
        const flow = flows[i];

        // One ordered pass, reset once before it. The steps are a lifecycle, not independent cases:
        // `readAgain` only means anything after `update` ran, and `readEmpty` only after `delete`.
        // Resetting per step would erase the very state each read is there to verify.
        await resetFixture(admin);
        for (const step of FLOW_STEPS) {
          const { run, check } = flow[step];
          const t0 = process.hrtime.bigint();
          const returned = await run();
          const elapsed = Number(process.hrtime.bigint() - t0) / 1000;
          if (round === 0) {
            check(returned);
          }
          if (round >= warmup) {
            samples[i][step].push(elapsed);
          }
        }
      }

      if (round === warmup - 1) {
        console.log(`warmup done (${warmup} rounds), measuring ${iterations}`);
      } else if (round >= warmup && (round - warmup + 1) % Math.max(1, Math.round(iterations / 5)) === 0) {
        console.log(`  ${round - warmup + 1}/${iterations}`);
      }
    }
  } finally {
    await clients.destroyAll();
    await admin.end();
  }

  const data: Record<string, Series> = Object.fromEntries(FLOW_STEPS.map((s) => [s, [] as Series]));

  console.log();
  for (const [i, entry] of FLOW_ENTRIES.entries()) {
    const perStep = new Map(FLOW_STEPS.map((step) => [step, Math.round(median(samples[i][step]))]));
    for (const [step, value] of perStep) {
      data[step].push(value);
    }
    const total = [...perStep.values()].reduce((sum, v) => sum + v, 0);
    const steps = [...perStep].map(([step, value]) => `${step}=${value}`).join(' ');
    console.log(entry.padEnd(17), steps, `| total=${total}µs`);
  }

  // Written straight into the shared artifacts rather than to a JSON file for another script to read.
  // `mergeDataset` keeps whatever generation results are already there, so either bench can be re-run
  // on its own without erasing the other.
  if (verifyOnly) {
    console.log('\n--verify: every step asserted, artifacts left alone');
    return;
  }

  syncResultsArtifacts(mergeDataset(flowDataset(data)));
  console.log('\nresults.js + README.md updated');
}

await main();
