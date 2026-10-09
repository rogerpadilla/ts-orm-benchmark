/**
 * The clients the probes are typed against, declared rather than imported so uql-orm.dev can load this file in a
 * browser without a `pg` pool. `clients.assert.ts` fails to compile when it drifts from `src/clients.ts`.
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
