/**
 * Live clients for the flow benchmark: one per entry, each connected to a real PostgreSQL through the
 * driver it would use in an application, plus the hand-written `pg` and Bun SQL floors.
 *
 * The floors are what make the numbers portable. Absolute latency depends heavily on how you reach
 * Postgres (a unix socket is ~7x faster than Docker Desktop on macOS), but "cost above raw `pg`" is the
 * ORM's own overhead and stays comparable across setups.
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
 * Bun's native SQL client, ~2.4x faster than `pg` on a trivial query and ~1.6x on a 200-row read. It is a
 * second reference floor: it shows how much of every entry's cost is really the driver rather than the ORM.
 * UQL and Drizzle ship a Bun SQL adapter in their own package, so both get an extra row and both are
 * labelled, because a faster driver is not an apples-to-apples ORM win.
 *
 * Imported dynamically, and only on Bun: a static `from 'bun'` makes the whole benchmark unloadable on
 * Node and Deno, which is what the runtime comparison needs it to survive.
 */
async function createBunSqlClients(connectionString: string) {
  const [{ SQL }, { BunSqlQuerierPool }, { drizzle: drizzleBunSql }] = await Promise.all([
    import('bun'),
    import('uql-orm/bunSql'),
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
