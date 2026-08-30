/**
 * The clients the probes are written against. Nothing here connects to anything: a probe is only ever
 * type-checked, never run, so each is `declare`d at the type an application would hold.
 *
 * Declared structurally rather than lifted off `src/clients.ts`, because this file is also the context
 * the live editor on uql-orm.dev loads, and reaching into `src/clients.ts` would drag a `pg` pool, a
 * driver adapter and Bun's globals into a browser that has no use for any of them. `clients.assert.ts`
 * is what keeps the two in step: it fails to compile the day this stops describing the real thing.
 */

import type { MikroORM } from '@mikro-orm/postgresql';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DataSource } from 'typeorm';
import type { SqlQuerierPool } from 'uql-orm';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { drizzleSchema, SqCompany, SqUser } from '../src/schema';

export declare const clients: {
  uql: SqlQuerierPool;
  prisma: PrismaClient;
  drizzleDb: NodePgDatabase<typeof drizzleSchema>;
  typeorm: DataSource;
  mikroOrm: MikroORM;
  SqUser: typeof SqUser;
  SqCompany: typeof SqCompany;
};
