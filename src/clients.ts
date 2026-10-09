/**
 * One live client per entry on a real PostgreSQL, plus the `pg` and Bun SQL floors, which keep "cost above the
 * driver" comparable however the database is reached.
 */

import { EntityCaseNamingStrategy, MikroORM } from '@mikro-orm/core';
import { defineConfig } from '@mikro-orm/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { Sequelize } from 'sequelize';
import { DataSource } from 'typeorm';
import { PgQuerierPool } from 'uql-orm/postgres';
import { PrismaClient } from './generated/prisma/client';
import { RUNTIME } from './runtime';
import {
  defineSequelizeModels,
  drizzleSchema,
  MikroCompanySchema,
  MikroUserSchema,
  TypeORMCompanySchema,
  TypeORMUserSchema,
} from './schema';

export type Clients = Awaited<ReturnType<typeof createClients>>;

/** Present only on Bun, where the `bun` module and the two adapters reaching it can be imported at all. */
export type BunSqlClients = Awaited<ReturnType<typeof createBunSqlClients>>;

/** Closes every client even when one fails, so a failed close can neither leak the rest nor hang the exit. */
export async function closeAll(closing: (Promise<unknown> | undefined)[]): Promise<void> {
  const failed = (await Promise.allSettled(closing)).flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
  if (failed.length) {
    throw new AggregateError(failed, `${failed.length} client(s) failed to close`);
  }
}

/**
 * Bun's SQL client as a second floor, and the UQL and Drizzle adapters each ship for it. Imported dynamically,
 * since a static `from 'bun'` would make the benchmark unloadable on Node.
 */
async function createBunSqlClients(connectionString: string) {
  const [{ SQL }, { BunSqlQuerierPool }, { drizzle: drizzleBunSql }] = await Promise.all([
    import('bun'),
    import('uql-orm/bun-sql'),
    import('drizzle-orm/bun-sql'),
  ]);

  const bunSql = new SQL(connectionString, { max: 1 });
  const uqlBunSql = new BunSqlQuerierPool({ url: connectionString, max: 1 });
  const drizzleClient = new SQL(connectionString, { max: 1 });
  const drizzleDb = drizzleBunSql(drizzleClient, { schema: drizzleSchema });

  const end = () => closeAll([drizzleClient.end(), uqlBunSql.end(), bunSql.end()]);

  return { bunSql, uqlBunSql, drizzleDb, end };
}

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

  const drizzlePool = new pg.Pool(poolOpts);
  const drizzleDb: NodePgDatabase<typeof drizzleSchema> = drizzle(drizzlePool, { schema: drizzleSchema });

  // Through the `pg` driver adapter, so Prisma runs on the same single connection as everything else
  // rather than on a pool of its own.
  const prisma = new PrismaClient({ adapter: new PrismaPg(poolOpts) });

  const bun = RUNTIME.name === 'bun' ? await createBunSqlClients(connectionString) : undefined;

  const destroyAll = () =>
    closeAll([
      prisma.$disconnect(),
      bun?.end(),
      drizzlePool.end(),
      mikroOrm.close(true),
      typeorm.isInitialized ? typeorm.destroy() : undefined,
      sequelize.close(),
      uql.end(),
      rawPg.end(),
    ]);

  // `sequelize` itself is not returned: the flow reaches it through its two models, and `destroyAll`
  // closes it from here.
  return {
    rawPg,
    uql,
    SqCompany,
    SqUser,
    typeorm,
    mikroOrm,
    drizzleDb,
    prisma,
    bun,
    destroyAll,
  };
}
