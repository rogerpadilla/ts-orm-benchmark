/**
 * What each entry does, per step of the lifecycle, in that entry's own idiomatic API. The whole point of
 * the benchmark is that these are not shared code, so the repetition between them is the measurement.
 *
 * Each builder takes only the client it needs; {@link FLOWS} is where an entry is wired to one.
 */

import { asc, eq, gt } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgQueryResultKind } from 'drizzle-orm/pg-core';
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
  TypeORMCompanySchema,
  TypeORMUserSchema,
  USER_TABLE,
  User,
} from '../src/schema';
import { SEED_COMPANIES } from './fixture';
import type { Entry, Step } from './model';

/** One step of the lifecycle: only `run` is timed, and it returns what a caller would use. */
export type Operation = { run: () => Promise<unknown> };

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

/** Declared once rather than per entry, so no entry can assert less than its peers. */
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

/** A step returns rows, one row, nothing, or an affected count: each read as how many rows it reached. */
function rowCount(returned: unknown): number {
  if (typeof returned === 'number') {
    return returned;
  }
  if (Array.isArray(returned)) {
    return returned.length;
  }
  return returned === null || returned === undefined ? 0 : 1;
}

const isRow = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** Runs after the timer stops, so reading an entry's return shape here costs it nothing. */
export function checkStep(entry: Entry, step: Step, returned: unknown): void {
  const rows = rowCount(returned);
  expect(rows === EXPECTED_ROWS[step], `${entry} ${step} returned ${rows} rows, expected ${EXPECTED_ROWS[step]}`);

  if (step === 'readAgain') {
    const name = isRow(returned) && 'name' in returned ? returned.name : undefined;
    expect(name === UPDATE_NAME, `${entry} readAgain saw ${JSON.stringify(name)}, expected the updated name`);
  }

  if (step === 'nested' && Array.isArray(returned)) {
    const populated = returned.every((parent) => isRow(parent) && 'users' in parent && rowCount(parent.users) > 0);
    expect(populated, `${entry} nested left a company without its users`);
  }
}

/** The flat row both floors read for the nested step, and map by hand: no ORM assembles this. */
type FlatRow = { cId: number; cName: string; uId: number | null; uName: string | null };

function nestFlatRows(rows: FlatRow[]) {
  const byId = new Map<number, { id: number; name: string; users: { id: number; name: string }[] }>();
  for (const row of rows) {
    let parent = byId.get(row.cId);
    if (!parent) {
      parent = { id: row.cId, name: row.cName, users: [] };
      byId.set(row.cId, parent);
    }
    if (row.uId !== null && row.uName !== null) {
      parent.users.push({ id: row.uId, name: row.uName });
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
      run: async () => (await db.query(`UPDATE "${USER_TABLE}" SET name=$1 WHERE id=$2`, [UPDATE_NAME, 1])).rowCount,
    },
    readAgain: {
      run: async () => (await db.query(`SELECT id,name FROM "${USER_TABLE}" WHERE id=$1`, [1])).rows[0],
    },
    nested: {
      run: async () =>
        nestFlatRows(
          (
            await db.query<FlatRow>(
              `SELECT c.id "cId", c.name "cName", u.id "uId", u.name "uName"
               FROM "${COMPANY_TABLE}" c LEFT JOIN "${USER_TABLE}" u ON u."companyId" = c.id
               WHERE c.id <= $1 ORDER BY c.id`,
              [NESTED_LIMIT],
            )
          ).rows,
        ),
    },
    delete: {
      run: async () => (await db.query(`DELETE FROM "${USER_TABLE}" WHERE id=$1`, [1])).rowCount,
    },
    readEmpty: {
      run: async () => (await db.query(`SELECT id FROM "${USER_TABLE}" WHERE id=$1`, [1])).rows[0],
    },
  };
}

function bunSqlFlow(sql: BunSqlClients['bunSql']): Flow {
  // Table names are literal: interpolating them would bind them as values, or escape them on every call.
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
      run: async () => (await sql`UPDATE "User" SET name=${UPDATE_NAME} WHERE id=1`).count,
    },
    readAgain: {
      run: async () => (await sql`SELECT id,name FROM "User" WHERE id=1`)[0],
    },
    nested: {
      run: async () => {
        const rows: FlatRow[] = await sql`
          SELECT c.id AS "cId", c.name AS "cName", u.id AS "uId", u.name AS "uName"
          FROM "Company" c LEFT JOIN "User" u ON u."companyId" = c.id
          WHERE c.id <= ${NESTED_LIMIT} ORDER BY c.id
        `;
        return nestFlatRows(rows);
      },
    },
    delete: {
      run: async () => (await sql`DELETE FROM "User" WHERE id=1`).count,
    },
    readEmpty: {
      run: async () => (await sql`SELECT id FROM "User" WHERE id=1`)[0],
    },
  };
}

function uqlFlow(q: Clients['uql'] | BunSqlClients['uqlBunSql']): Flow {
  return {
    insert: {
      run: () => q.insertMany(User, NEW_USERS),
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
      run: () => q.updateOneById(User, 1, { name: UPDATE_NAME }),
    },
    readAgain: {
      run: () => q.findOneById(User, 1, { $select: { id: true, name: true } }),
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
      run: () => q.deleteOneById(User, 1),
    },
    readEmpty: {
      run: () => q.findOneById(User, 1, { $select: { id: true } }),
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
      run: async () => (await SqUser.update({ name: UPDATE_NAME }, { where: { id: 1 } }))[0],
    },
    readAgain: {
      run: () => SqUser.findByPk(1, { attributes: ['id', 'name'] }),
    },
    nested: {
      run: () =>
        SqCompany.findAll({
          attributes: ['id', 'name'],
          include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
          where: { id: { [Op.lte]: NESTED_LIMIT } },
          order: [['id', 'ASC']],
        }),
    },
    delete: {
      run: () => SqUser.destroy({ where: { id: 1 } }),
    },
    readEmpty: {
      run: () => SqUser.findByPk(1, { attributes: ['id'] }),
    },
  };
}

function typeormFlow(ds: Clients['typeorm']): Flow {
  const repo = ds.getRepository(TypeORMUserSchema);
  const companies = ds.getRepository(TypeORMCompanySchema);
  return {
    insert: {
      run: async () => (await repo.insert(NEW_USERS)).identifiers,
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
      run: async () => (await repo.update({ id: 1 }, { name: UPDATE_NAME })).affected,
    },
    readAgain: {
      run: () => repo.findOne({ select: { id: true, name: true }, where: { id: 1 } }),
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
      run: async () => (await repo.delete({ id: 1 })).affected,
    },
    readEmpty: {
      run: () => repo.findOne({ select: { id: true }, where: { id: 1 } }),
    },
  };
}

function mikroFlow(orm: Clients['mikroOrm']): Flow {
  // A request-scoped fork per operation, as MikroORM's docs call for: https://mikro-orm.io/docs/identity-map
  const fork = () => orm.em.fork();
  const mikroNew = NEW_USERS.map(({ companyId, ...user }) => ({ ...user, company: companyId }));
  return {
    insert: {
      // `em.insertMany` returns only the first id, so the insert stays on the builder (see README, Method).
      run: async () => (await fork().createQueryBuilder(MikroUserSchema).insert(mikroNew).execute()).rows,
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
    },
    readAgain: {
      run: () => fork().findOne(MikroUserSchema, 1, { fields: ['id', 'name'] }),
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
    },
    readEmpty: {
      run: () => fork().findOne(MikroUserSchema, 1, { fields: ['id'] }),
    },
  };
}

/** Same builder on both drivers; only how each reports affected rows differs. */
function drizzleFlow<H extends PgQueryResultHKT>(
  db: PgDatabase<H, typeof drizzleSchema>,
  affected: (result: PgQueryResultKind<H, never>) => number,
): Flow {
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
      run: async () => affected(await db.update(drizzleUsers).set({ name: UPDATE_NAME }).where(eq(drizzleUsers.id, 1))),
    },
    readAgain: {
      run: async () =>
        (
          await db
            .select({ id: drizzleUsers.id, name: drizzleUsers.name })
            .from(drizzleUsers)
            .where(eq(drizzleUsers.id, 1))
        )[0],
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
      run: async () => affected(await db.delete(drizzleUsers).where(eq(drizzleUsers.id, 1))),
    },
    readEmpty: {
      run: async () => (await db.select({ id: drizzleUsers.id }).from(drizzleUsers).where(eq(drizzleUsers.id, 1)))[0],
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
    },
    readAgain: {
      run: () => db.user.findUnique({ select: { id: true, name: true }, where: { id: 1 } }),
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
    },
    readEmpty: {
      run: () => db.user.findUnique({ select: { id: true }, where: { id: 1 } }),
    },
  };
}

/** Bun's result carries `count`, which Drizzle's type for it leaves out. */
const bunSqlCount = (result: unknown): number =>
  isRow(result) && 'count' in result && typeof result.count === 'number' ? result.count : 0;

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
  Drizzle: (c) => drizzleFlow(c.drizzleDb, (result) => result.rowCount ?? 0),
  'Drizzle (bunSql)': (c) => drizzleFlow(bunSqlOf(c).drizzleDb, bunSqlCount),
  Prisma: (c) => prismaFlow(c.prisma),
};
