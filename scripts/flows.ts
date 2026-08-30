/**
 * What each entry does, per step of the lifecycle, in that entry's own idiomatic API. The whole point of
 * the benchmark is that these are not shared code, so the repetition between them is the measurement.
 *
 * Each builder takes only the client it needs; {@link FLOWS} is where an entry is wired to one.
 */

import type { SqlEntityManager } from '@mikro-orm/postgresql';
import { asc, eq, gt } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Op } from 'sequelize';
import { LessThanOrEqual, MoreThan } from 'typeorm';
import type { BunSqlClients, Clients } from '../src/clients';
import {
  COMPANY_TABLE,
  Company,
  type drizzleSchema,
  drizzleUsers,
  MikroCompanySchema,
  MikroUserSchema,
  type SqCompany as SqCompanyModel,
  TypeORMCompanySchema,
  TypeORMUserSchema,
  USER_TABLE,
  User,
} from '../src/schema';
import { SEED_COMPANIES } from './fixture';
import type { Entry, Step } from './model';

/**
 * One step of the lifecycle. `run` is the only part that is timed; `rows` and `children` just read a
 * count out of whatever this entry's API hands back, which is the entry's business. What that count has
 * to be is the step's, and lives in {@link EXPECTED_ROWS} so no entry can assert less than its peers.
 */
export type Operation = {
  run: () => Promise<unknown>;
  /** For an API that reports affected rows instead of returning them. Defaults to the array's length. */
  rows?: (returned: unknown) => number;
  /** For a nested read that does not hand back plain `{ users: [...] }` parents. */
  children?: (parent: unknown) => unknown[] | undefined;
};

export type Flow = Record<Step, Operation>;

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

/**
 * What every entry has to produce, per step. Declared once rather than per entry: when each flow carried
 * its own assertions, MikroORM's insert, update and delete asserted nothing and Prisma's update and
 * delete only asserted a truthy return, so those steps could have done nothing and still scored well.
 */
const EXPECTED_ROWS: Record<Step, number> = {
  insert: NEW_USERS.length,
  read: READ_LIMIT,
  update: 1,
  readAgain: 1,
  nested: NESTED_LIMIT,
  delete: 1,
  readEmpty: 0,
};

function expect(cond: boolean, message: string) {
  if (!cond) {
    throw new Error(`flow assertion failed: ${message}`);
  }
}

/** Rows come back with different key casing and numeric types per driver; only the shape is asserted. */
function rowCount(returned: unknown): number {
  return Array.isArray(returned) ? returned.length : 0;
}

/** Runs after the timer stops, so normalising an entry's return shape here costs it nothing. */
export function checkStep(entry: Entry, step: Step, op: Operation, returned: unknown): void {
  const rows = (op.rows ?? rowCount)(returned);
  expect(rows === EXPECTED_ROWS[step], `${entry} ${step} returned ${rows} rows, expected ${EXPECTED_ROWS[step]}`);

  if (step === 'readAgain') {
    const name = (returned as { name?: string }[])[0]?.name;
    expect(name === UPDATE_NAME, `${entry} readAgain saw ${JSON.stringify(name)}, expected the updated name`);
  }

  if (step === 'nested') {
    const children = op.children ?? ((parent: unknown) => (parent as { users?: unknown[] }).users);
    const populated = (returned as unknown[]).every((parent) => (children(parent)?.length ?? 0) > 0);
    expect(populated, `${entry} nested left a company without its users`);
  }
}

/** Both driver-level counts an ORM can hand back instead of rows. */
const affectedRows = (returned: unknown) => (returned as { affectedRows?: number }).affectedRows ?? 0;
const oneIfReturned = (returned: unknown) => (returned ? 1 : 0);

/** The floors map rows by hand, which is the point of them: no ORM assembles this. */
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

function rawPgFlow(db: Clients['rawPg']): Flow {
  // Hoisted: the statement is constant, so a hand-written implementation would build it once.
  const insertSql = `INSERT INTO "${USER_TABLE}" (name,email,"companyId","createdAt") VALUES ${NEW_USERS.map(
    (_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`,
  ).join(',')} RETURNING id`;
  const insertParams = NEW_USERS.flatMap((u) => [u.name, u.email, u.companyId, u.createdAt]);
  return {
    insert: {
      run: async () => (await db.query(insertSql, insertParams)).rows,
    },
    read: {
      run: async () =>
        (
          await db.query(
            `SELECT id,name,email,"companyId","createdAt" FROM "${USER_TABLE}" WHERE "companyId" > $1 ORDER BY id LIMIT $2`,
            [0, READ_LIMIT],
          )
        ).rows,
    },
    update: {
      run: async () =>
        (await db.query(`UPDATE "${USER_TABLE}" SET name=$1 WHERE id=$2 RETURNING id`, [UPDATE_NAME, 1])).rows,
    },
    readAgain: {
      run: async () => (await db.query(`SELECT id,name FROM "${USER_TABLE}" WHERE id=$1`, [1])).rows,
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
        return nestFlatRows(rows);
      },
    },
    delete: {
      run: async () => (await db.query(`DELETE FROM "${USER_TABLE}" WHERE id=$1 RETURNING id`, [1])).rows,
    },
    readEmpty: {
      run: async () => (await db.query(`SELECT id FROM "${USER_TABLE}" WHERE id=$1`, [1])).rows,
    },
  };
}

function bunSqlFlow(sql: BunSqlClients['bunSql']): Flow {
  return {
    insert: {
      // Bun expands an array of objects into the column list and the VALUES tuples itself.
      run: () => sql`INSERT INTO "User" ${sql(NEW_USERS)} RETURNING id`,
    },
    read: {
      run: () =>
        sql`SELECT id,name,email,"companyId","createdAt" FROM "User" WHERE "companyId" > 0 ORDER BY id LIMIT ${READ_LIMIT}`,
    },
    update: {
      run: () => sql`UPDATE "User" SET name=${UPDATE_NAME} WHERE id=1 RETURNING id`,
    },
    readAgain: {
      run: () => sql`SELECT id,name FROM "User" WHERE id=1`,
    },
    nested: {
      run: async () => {
        const rows = (await sql`
          SELECT c.id AS "cId", c.name AS "cName", u.id AS "uId", u.name AS "uName"
          FROM "Company" c LEFT JOIN "User" u ON u."companyId" = c.id
          WHERE c.id <= ${NESTED_LIMIT} ORDER BY c.id
        `) as { cId: number; cName: string; uId: number | null; uName: string | null }[];
        return nestFlatRows(rows);
      },
    },
    delete: {
      run: () => sql`DELETE FROM "User" WHERE id=1 RETURNING id`,
    },
    readEmpty: {
      run: () => sql`SELECT id FROM "User" WHERE id=1`,
    },
  };
}

function uqlFlow(q: Clients['uql'] | BunSqlClients['uqlBunSql']): Flow {
  return {
    insert: {
      run: () => q.insertMany<User>(User, NEW_USERS),
    },
    read: {
      run: () =>
        q.findMany(User, {
          $select: { id: true, name: true, email: true, companyId: true, createdAt: true },
          $where: { companyId: { $gt: 0 } },
          $sort: { id: 1 },
          $limit: READ_LIMIT,
        }),
    },
    update: {
      run: () => q.updateMany(User, { $where: { id: 1 } }, { name: UPDATE_NAME }),
      rows: Number,
    },
    readAgain: {
      run: () => q.findMany(User, { $select: { id: true, name: true }, $where: { id: 1 } }),
    },
    nested: {
      run: () =>
        q.findMany(Company, {
          $select: { id: true, name: true },
          $populate: { users: { $select: { id: true, name: true } } },
          $where: { id: { $lte: NESTED_LIMIT } },
          $sort: { id: 1 },
        }),
    },
    delete: {
      run: () => q.deleteMany(User, { $where: { id: 1 } }),
      rows: Number,
    },
    readEmpty: {
      run: () => q.findMany(User, { $select: { id: true }, $where: { id: 1 } }),
    },
  };
}

function sequelizeFlow({ SqUser, SqCompany }: Pick<Clients, 'SqUser' | 'SqCompany'>): Flow {
  return {
    insert: {
      run: () => SqUser.bulkCreate(NEW_USERS),
    },
    read: {
      run: () =>
        SqUser.findAll({
          attributes: ['id', 'name', 'email', 'companyId', 'createdAt'],
          where: { companyId: { [Op.gt]: 0 } },
          order: [['id', 'ASC']],
          limit: READ_LIMIT,
        }),
    },
    update: {
      run: () => SqUser.update({ name: UPDATE_NAME }, { where: { id: 1 } }),
      rows: (r) => (r as number[])[0],
    },
    readAgain: {
      run: () => SqUser.findAll({ attributes: ['id', 'name'], where: { id: 1 } }),
    },
    nested: {
      run: () =>
        SqCompany.findAll({
          attributes: ['id', 'name'],
          include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
          where: { id: { [Op.lte]: NESTED_LIMIT } },
          order: [['id', 'ASC']],
        }),
      children: (parent) => (parent as SqCompanyModel).users,
    },
    delete: {
      run: () => SqUser.destroy({ where: { id: 1 } }),
      rows: Number,
    },
    readEmpty: {
      run: () => SqUser.findAll({ attributes: ['id'], where: { id: 1 } }),
    },
  };
}

function typeormFlow(ds: Clients['typeorm']): Flow {
  const repo = ds.getRepository(TypeORMUserSchema);
  const companies = ds.getRepository(TypeORMCompanySchema);
  return {
    insert: {
      run: () => repo.insert(NEW_USERS),
      rows: (r) => (r as { identifiers: unknown[] }).identifiers.length,
    },
    read: {
      run: () =>
        repo.find({
          select: { id: true, name: true, email: true, companyId: true, createdAt: true },
          where: { companyId: MoreThan(0) },
          order: { id: 'ASC' },
          take: READ_LIMIT,
        }),
    },
    update: {
      run: () => repo.update({ id: 1 }, { name: UPDATE_NAME }),
      rows: (r) => (r as { affected?: number }).affected ?? 0,
    },
    readAgain: {
      run: () => repo.find({ select: { id: true, name: true }, where: { id: 1 } }),
    },
    nested: {
      run: () =>
        companies.find({
          select: { id: true, name: true, users: { id: true, name: true } },
          relations: { users: true },
          where: { id: LessThanOrEqual(NESTED_LIMIT) },
          order: { id: 'ASC' },
        }),
    },
    delete: {
      run: () => repo.delete({ id: 1 }),
      rows: (r) => (r as { affected?: number }).affected ?? 0,
    },
    readEmpty: {
      run: () => repo.find({ select: { id: true }, where: { id: 1 } }),
    },
  };
}

function mikroFlow(orm: Clients['mikroOrm']): Flow {
  // A fresh EntityManager per operation, the same request-scoped fork MikroORM's own docs call for
  // (https://mikro-orm.io/docs/identity-map), instead of one shared em accumulating Unit-of-Work state
  // across the whole run.
  //
  // Through the EntityManager rather than `createQueryBuilder`, which is what this used to time. The
  // builder is the escape hatch; `em.find` is the API MikroORM's docs lead with, it is the one the
  // type-safety probes are scored on, and timing one while scoring the other made the two halves of the
  // report about two different MikroORMs. It is not a handicap either: measured over 160 rounds of the
  // 200-row read, `em.find` came in at 1253µs against the builder's 1294µs.
  const fork = () => orm.em.fork() as SqlEntityManager;
  const mikroNew = NEW_USERS.map((u) => ({
    name: u.name,
    email: u.email,
    company: u.companyId,
    createdAt: u.createdAt,
  }));
  return {
    insert: {
      // The one step still on the builder, and the probes match it. `em.insertMany` emits the identical
      // single `INSERT ... RETURNING "id"`, but hands back only the first id rather than all ten, so the
      // step could not be asserted through it - and an insert nobody can count is how MikroORM's used to
      // score well while doing nothing.
      run: () => fork().createQueryBuilder(MikroUserSchema).insert(mikroNew).execute(),
      rows: affectedRows,
    },
    read: {
      run: () =>
        fork().find(
          MikroUserSchema,
          { company: { $gt: 0 } },
          { fields: ['id', 'name', 'email', 'company', 'createdAt'], orderBy: { id: 'ASC' }, limit: READ_LIMIT },
        ),
    },
    update: {
      run: () => fork().nativeUpdate(MikroUserSchema, { id: 1 }, { name: UPDATE_NAME }),
      rows: Number,
    },
    readAgain: {
      run: () => fork().find(MikroUserSchema, { id: 1 }, { fields: ['id', 'name'] }),
    },
    nested: {
      run: () =>
        fork().find(
          MikroCompanySchema,
          { id: { $lte: NESTED_LIMIT } },
          { fields: ['id', 'name', 'users.id', 'users.name'], populate: ['users'], orderBy: { id: 'ASC' } },
        ),
    },
    delete: {
      run: () => fork().nativeDelete(MikroUserSchema, { id: 1 }),
      rows: Number,
    },
    readEmpty: {
      run: () => fork().find(MikroUserSchema, { id: 1 }, { fields: ['id'] }),
    },
  };
}

function drizzleFlow(db: PgDatabase<PgQueryResultHKT, typeof drizzleSchema>): Flow {
  return {
    insert: {
      run: () => db.insert(drizzleUsers).values(NEW_USERS).returning({ id: drizzleUsers.id }),
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
    },
    update: {
      run: () =>
        db
          .update(drizzleUsers)
          .set({ name: UPDATE_NAME })
          .where(eq(drizzleUsers.id, 1))
          .returning({ id: drizzleUsers.id }),
    },
    readAgain: {
      run: () =>
        db.select({ id: drizzleUsers.id, name: drizzleUsers.name }).from(drizzleUsers).where(eq(drizzleUsers.id, 1)),
    },
    nested: {
      run: () =>
        db.query.Company.findMany({
          columns: { id: true, name: true },
          with: { users: { columns: { id: true, name: true } } },
          where: (t, { lte }) => lte(t.id, NESTED_LIMIT),
          orderBy: (t, { asc: a }) => a(t.id),
        }),
    },
    delete: {
      run: () => db.delete(drizzleUsers).where(eq(drizzleUsers.id, 1)).returning({ id: drizzleUsers.id }),
    },
    readEmpty: {
      run: () => db.select({ id: drizzleUsers.id }).from(drizzleUsers).where(eq(drizzleUsers.id, 1)),
    },
  };
}

function prismaFlow(db: Clients['prisma']): Flow {
  return {
    insert: {
      // `createManyAndReturn` is the one call that inserts a batch and hands back the ids, which is what
      // every other entry's insert step does.
      run: () => db.user.createManyAndReturn({ data: NEW_USERS, select: { id: true } }),
    },
    read: {
      run: () =>
        db.user.findMany({
          select: { id: true, name: true, email: true, companyId: true, createdAt: true },
          where: { companyId: { gt: 0 } },
          orderBy: { id: 'asc' },
          take: READ_LIMIT,
        }),
    },
    update: {
      run: () => db.user.update({ where: { id: 1 }, data: { name: UPDATE_NAME }, select: { id: true } }),
      rows: oneIfReturned,
    },
    readAgain: {
      run: () => db.user.findMany({ select: { id: true, name: true }, where: { id: 1 } }),
    },
    nested: {
      run: () =>
        db.company.findMany({
          select: { id: true, name: true, users: { select: { id: true, name: true } } },
          where: { id: { lte: NESTED_LIMIT } },
          orderBy: { id: 'asc' },
        }),
    },
    delete: {
      run: () => db.user.delete({ where: { id: 1 }, select: { id: true } }),
      rows: oneIfReturned,
    },
    readEmpty: {
      run: () => db.user.findMany({ select: { id: true }, where: { id: 1 } }),
    },
  };
}

/** The Bun-only entries are filtered out off Bun, so reaching one there is a bug, not a runtime gap. */
function bunSqlOf(c: Clients): BunSqlClients {
  if (!c.bun) {
    throw new Error('Bun SQL entries need the Bun runtime');
  }
  return c.bun;
}

export const FLOWS: Record<Entry, (c: Clients) => Flow> = {
  'raw pg': (c) => rawPgFlow(c.rawPg),
  'bun sql': (c) => bunSqlFlow(bunSqlOf(c).bunSql),
  UQL: (c) => uqlFlow(c.uql),
  'UQL (bunSql)': (c) => uqlFlow(bunSqlOf(c).uqlBunSql),
  Sequelize: sequelizeFlow,
  TypeORM: (c) => typeormFlow(c.typeorm),
  MikroORM: (c) => mikroFlow(c.mikroOrm),
  Drizzle: (c) => drizzleFlow(c.drizzleDb),
  // Same query-building API, different driver: both db types extend the `PgDatabase` the flow is written
  // against, and differ only in the driver internals it never touches.
  'Drizzle (bunSql)': (c) => drizzleFlow(bunSqlOf(c).drizzleDb),
  Prisma: (c) => prismaFlow(c.prisma),
};
