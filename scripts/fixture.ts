/**
 * The database the benchmark runs against: created once, then reset to the same 50 companies and 200 users
 * before every entry's pass, so no entry ever sees another's leftovers.
 */

import pg from 'pg';
import { COMPANY_TABLE, SEED_COMPANIES, SEED_USERS, TABLE_DDL, USER_TABLE } from '../src/schema';

const BENCH_DB = 'ts_orm_bench';

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
