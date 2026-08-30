/**
 * The database the benchmark runs against: the rows every entry is seeded with, the tables they live in,
 * and the reset that puts both back before every entry's pass, so no entry ever sees another's leftovers.
 *
 * The models these rows are read through are `src/schema.ts`, one definition per ORM.
 */

import pg from 'pg';
import { COMPANY_TABLE, USER_TABLE } from '../src/schema';

const BENCH_DB = 'ts_orm_bench';

type CompanyRow = { id: number; name: string };
type UserRow = { id: number; name: string; email: string; companyId: number; createdAt: number };

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
const SEED_USERS: readonly UserRow[] = Array.from({ length: COMPANY_COUNT * USERS_PER_COMPANY }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  companyId: (i % COMPANY_COUNT) + 1,
  createdAt: 1_000_000 + i,
}));

const TABLE_DDL = [
  /*sql*/ `CREATE TABLE "${COMPANY_TABLE}" (
    id serial PRIMARY KEY,
    name text NOT NULL
  )`,
  /*sql*/ `CREATE TABLE "${USER_TABLE}" (
    id serial PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    "companyId" int REFERENCES "${COMPANY_TABLE}"(id),
    "createdAt" int
  )`,
  /*sql*/ `CREATE INDEX "User_companyId_idx" ON "${USER_TABLE}" ("companyId")`,
];

/** Its own database, never the one `DATABASE_URL` points at: the reset truncates tables. */
export async function ensureDatabase(baseUrl: string): Promise<string> {
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [BENCH_DB]);
  if (exists.rowCount === 0) {
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

export async function resetFixture(admin: pg.Pool) {
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

/** The version string without the platform tail, which is what the report quotes. */
export async function postgresVersion(admin: pg.Pool): Promise<string> {
  const { rows } = await admin.query('SELECT version()');
  return (rows[0].version as string).split(' on ')[0];
}
