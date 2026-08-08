/**
 * Live clients for the flow benchmark: the same seven entries the generation benchmark compiles, each
 * connected to a real PostgreSQL through the driver and dialect it already uses there, plus a raw `pg`
 * baseline.
 *
 * The baseline is what makes the numbers portable. Absolute latency depends heavily on how you reach
 * Postgres (a unix socket is ~7x faster than Docker Desktop on macOS), but "cost above raw `pg`" is the
 * ORM's own overhead and stays comparable across setups.
 */

import { EntityCaseNamingStrategy, MikroORM } from '@mikro-orm/core';
import { defineConfig, type SqlEntityManager } from '@mikro-orm/postgresql';
import { SQL } from 'bun';
import { drizzle as drizzleBunSql } from 'drizzle-orm/bun-sql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import knexLib, { type Knex } from 'knex';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { Sequelize } from 'sequelize';
import { DataSource } from 'typeorm';
import { BunSqlQuerierPool } from 'uql-orm/bunSql';
import { PgQuerierPool } from 'uql-orm/postgres';
import {
  defineSequelizeModels,
  drizzleSchema,
  type KyselyDb,
  MikroCompanySchema,
  MikroUserSchema,
  TypeORMCompanySchema,
  TypeORMUserSchema,
} from './schema';

export type Clients = Awaited<ReturnType<typeof createClients>>;

/**
 * One connection each. Pooling is deliberately out of scope: this measures per-request ORM overhead, and
 * a pool that hands back a warm connection would add variance without changing what is being compared.
 */
export async function createClients(connectionString: string) {
  const poolOpts = { connectionString, max: 1 };

  const rawPg = new pg.Pool(poolOpts);

  const uql = new PgQuerierPool(poolOpts);

  const sequelize = new Sequelize(connectionString, { logging: false, dialect: 'postgres', pool: { max: 1 } });
  const { SqCompany, SqUser } = defineSequelizeModels(sequelize);

  const typeorm = new DataSource({
    type: 'postgres',
    url: connectionString,
    entities: [TypeORMCompanySchema, TypeORMUserSchema],
    synchronize: false,
    logging: false,
    installExtensions: false,
    extra: { max: 1 },
  });
  await typeorm.initialize();

  const mikroOrm = await MikroORM.init(
    defineConfig({
      clientUrl: connectionString,
      entities: [MikroCompanySchema, MikroUserSchema],
      // Same identifiers ("User", "companyId") as every other entry.
      namingStrategy: EntityCaseNamingStrategy,
      pool: { min: 0, max: 1 },
    }),
  );
  const mikroEm = mikroOrm.em.fork() as unknown as SqlEntityManager;

  const drizzlePool = new pg.Pool(poolOpts);
  const drizzleDb: NodePgDatabase<typeof drizzleSchema> = drizzle(drizzlePool, { schema: drizzleSchema });

  const knexDb: Knex = knexLib({ client: 'pg', connection: connectionString, pool: { min: 0, max: 1 } });

  const kyselyPool = new pg.Pool(poolOpts);
  const kyselyDb = new Kysely<KyselyDb>({ dialect: new PostgresDialect({ pool: kyselyPool }) });

  // Bun's native SQL client, ~2.4x faster than `pg` on a trivial query and ~1.6x on a 200-row read. It is
  // a second reference floor: it shows how much of every entry's cost is really the driver rather than the
  // ORM. UQL and Drizzle are the only two entries with a Bun SQL adapter, so both get an extra row and
  // both are labelled, because a faster driver is not an apples-to-apples ORM win.
  const bunSql = new SQL(connectionString, { max: 1 });
  const uqlBunSql = new BunSqlQuerierPool({ url: connectionString, max: 1 });
  const drizzleBunClient = new SQL(connectionString, { max: 1 });
  const drizzleBunDb = drizzleBunSql(drizzleBunClient, { schema: drizzleSchema });

  async function destroyAll() {
    await drizzleBunClient.end();
    await uqlBunSql.end();
    await bunSql.end();
    await kyselyDb.destroy();
    await knexDb.destroy();
    await drizzlePool.end();
    await mikroOrm.close(true);
    if (typeorm.isInitialized) {
      await typeorm.destroy();
    }
    await sequelize.close();
    await uql.end();
    await rawPg.end();
  }

  return {
    rawPg,
    uql,
    sequelize,
    SqCompany,
    SqUser,
    typeorm,
    mikroEm,
    drizzleDb,
    knexDb,
    kyselyDb,
    bunSql,
    uqlBunSql,
    drizzleBunDb,
    destroyAll,
  };
}
