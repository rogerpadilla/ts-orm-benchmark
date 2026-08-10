/**
 * What an ORM costs on a real PostgreSQL round trip: the trip itself, turning driver rows back into
 * objects, and assembling nested relations. The steps are a lifecycle (insert, read, update, read,
 * nested read, delete, read) so each read verifies the write before it, which means a step that
 * silently does nothing fails instead of scoring well.
 *
 * Reported in µs per operation, lower is better, against the hand-written `raw pg` and `bun sql`
 * floors. Those floors are the point: absolute latency swings with how you reach Postgres, but the gap
 * above the floor is the ORM's own overhead and is comparable across setups.
 *
 * Usage:
 *   DATABASE_URL=postgres:///postgres bun scripts/flow-bench.ts
 *   bun scripts/flow-bench.ts --iterations 400
 *   bun scripts/flow-bench.ts --iterations 3 --verify   # assert every step, write nothing
 */

import type { SqlEntityManager } from '@mikro-orm/postgresql';
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
import { ENTRIES, type Entry, printSummary, type Results, STEPS, type Step, syncResults } from './report.js';

const BENCH_DB = 'ts_orm_bench';

/**
 * One step of the lifecycle. `run` is the only part that is timed; `rows` and `children` just read a
 * count out of whatever this entry's API hands back, which is the entry's business. What that count has
 * to be is the step's, and lives in {@link EXPECTED_ROWS} so no entry can assert less than its peers.
 */
type Operation = {
  run: () => Promise<unknown>;
  /** For an API that reports affected rows instead of returning them. Defaults to the array's length. */
  rows?: (returned: unknown) => number;
  /** For a nested read that does not hand back plain `{ users: [...] }` parents. */
  children?: (parent: unknown) => unknown[] | undefined;
};
type Flow = Record<Step, Operation>;

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

/** Runs after the timer stops, so normalising an entry's return shape here costs it nothing. */
function checkStep(entry: Entry, step: Step, op: Operation, returned: unknown): void {
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

function rawPgFlow(c: Clients): Flow {
  const db = c.rawPg;
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

function bunSqlFlow(c: Clients): Flow {
  const sql = c.bunSql;
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

function uqlFlow(c: Clients, q: Clients['uql'] | Clients['uqlBunSql'] = c.uql): Flow {
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
      rows: (r) => Number(r),
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
      rows: (r) => Number(r),
    },
    readEmpty: {
      run: () => q.findMany(User, { $select: { id: true }, $where: { id: 1 } }),
    },
  };
}

function sequelizeFlow(c: Clients): Flow {
  const { SqUser, SqCompany } = c;
  return {
    insert: {
      run: () => SqUser.bulkCreate(NEW_USERS as never[]),
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
      children: (parent) => (parent as { get: (key: string) => unknown[] }).get('users'),
    },
    delete: {
      run: () => SqUser.destroy({ where: { id: 1 } }),
      rows: (r) => Number(r),
    },
    readEmpty: {
      run: () => SqUser.findAll({ attributes: ['id'], where: { id: 1 } }),
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
          select: { id: true, name: true },
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

function mikroFlow(c: Clients): Flow {
  // A fresh EntityManager per operation, the same request-scoped fork MikroORM's own docs call for
  // (https://mikro-orm.io/docs/identity-map), instead of one shared em accumulating Unit-of-Work state
  // across the whole run.
  const fork = () => c.mikroOrm.em.fork() as SqlEntityManager;
  const mikroNew = NEW_USERS.map((u) => ({
    name: u.name,
    email: u.email,
    company: u.companyId,
    createdAt: u.createdAt,
  }));
  return {
    insert: {
      run: () => fork().createQueryBuilder(MikroUserSchema).insert(mikroNew).execute(),
      rows: (r) => (r as { affectedRows?: number }).affectedRows ?? 0,
    },
    read: {
      run: () =>
        fork()
          .createQueryBuilder(MikroUserSchema)
          .select(['id', 'name', 'email', 'company', 'createdAt'])
          .where({ company: { $gt: 0 } })
          .orderBy({ id: 'ASC' })
          .limit(READ_LIMIT)
          .getResult(),
    },
    update: {
      run: () => fork().createQueryBuilder(MikroUserSchema).update({ name: UPDATE_NAME }).where({ id: 1 }).execute(),
      rows: (r) => (r as { affectedRows?: number }).affectedRows ?? 0,
    },
    readAgain: {
      run: () => fork().createQueryBuilder(MikroUserSchema).select(['id', 'name']).where({ id: 1 }).getResult(),
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
      run: () => fork().createQueryBuilder(MikroUserSchema).delete().where({ id: 1 }).execute(),
      rows: (r) => (r as { affectedRows?: number }).affectedRows ?? 0,
    },
    readEmpty: {
      run: () => fork().createQueryBuilder(MikroUserSchema).select(['id']).where({ id: 1 }).getResult(),
    },
  };
}

function drizzleFlow(c: Clients, db: Clients['drizzleDb'] = c.drizzleDb): Flow {
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

function prismaFlow(c: Clients): Flow {
  const db = c.prisma;
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
      rows: (r) => (r ? 1 : 0),
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
      rows: (r) => (r ? 1 : 0),
    },
    readEmpty: {
      run: () => db.user.findMany({ select: { id: true }, where: { id: 1 } }),
    },
  };
}

const FLOWS: Record<Entry, (c: Clients) => Flow> = {
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
  Prisma: prismaFlow,
};

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
  // Half the run again as warmup: below that, per-entry figures swing by hundreds of µs between runs.
  const warmup = Math.max(40, Math.round(iterations / 2));

  console.log(`flow benchmark: ${iterations} iterations/step, ${warmup} warmup`);
  const benchUrl = await ensureDatabase(baseUrl);
  const admin = new pg.Pool({ connectionString: benchUrl, max: 1 });
  const version = (await admin.query('SELECT version()')).rows[0].version as string;
  console.log(version.split(' on ')[0], '\n');

  const clients = await createClients(benchUrl);
  // Built once. Some flows hoist a constant statement out of the timed section, which only holds if the
  // flow itself is not rebuilt per iteration.
  const flows = ENTRIES.map((entry) => FLOWS[entry](clients));
  const samples = ENTRIES.map(
    () => Object.fromEntries(STEPS.map((s) => [s, [] as number[]])) as Record<Step, number[]>,
  );
  const rounds = warmup + iterations;

  try {
    for (let round = 0; round < rounds; round++) {
      // One pass per entry per round, rotated so each spends an equal share of its samples in every
      // position. Running each entry to completion made the result depend on declaration order.
      for (let k = 0; k < flows.length; k++) {
        const i = (k + round) % flows.length;
        const flow = flows[i];

        // One ordered pass, reset once before it. The steps are a lifecycle, not independent cases:
        // `readAgain` only means anything after `update` ran, and `readEmpty` only after `delete`.
        // Resetting per step would erase the very state each read is there to verify.
        await resetFixture(admin);
        for (const step of STEPS) {
          const op = flow[step];
          const t0 = process.hrtime.bigint();
          const returned = await op.run();
          const elapsed = Number(process.hrtime.bigint() - t0) / 1000;
          if (round === 0) {
            checkStep(ENTRIES[i], step, op, returned);
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

  const results = Object.fromEntries(
    STEPS.map((step) => [step, ENTRIES.map((_, i) => Math.round(median(samples[i][step])))]),
  ) as Results;

  console.log();
  printSummary(results);

  if (verifyOnly) {
    console.log('\n--verify: every step asserted, nothing written');
    return;
  }

  syncResults(results);
  console.log('\nresults.js + README.md updated');
}

await main();
