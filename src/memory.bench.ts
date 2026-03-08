/**
 * Measures memory (heap) usage after importing and initializing each ORM.
 * Run: bun src/memory.bench.ts
 */

export async function measureHeap(label: string, fn: () => Promise<void>) {
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  await fn();
  Bun.gc(true);
  const after = process.memoryUsage().heapUsed;
  const delta = (after - before) / 1024 / 1024;
  console.log(`${label.padEnd(12)} ${delta.toFixed(2)} MB`);
}

console.log('ORM          Heap (MB)');
console.log('─'.repeat(25));

await measureHeap('UQL', async () => {
  const { Entity, Field, Id } = await import('uql');
  const { PostgresDialect } = await import('uql/postgres');
  @Entity() class User {
    @Id() id?: number;
    @Field() name?: string;
    @Field() email?: string;
    @Field() companyId?: number;
    @Field() createdAt?: number;
  }
  const dialect = new PostgresDialect();
  const ctx = dialect.createContext();
  dialect.find(ctx, User, { $select: { name: true } });
});

await measureHeap('Sequelize', async () => {
  const { Sequelize, DataTypes } = await import('sequelize');
  const seq = new Sequelize('postgres://x:x@localhost/x', { logging: false, dialect: 'postgres' });
  seq.define('User', {
    name: DataTypes.STRING,
    email: DataTypes.STRING,
    companyId: DataTypes.INTEGER,
    createdAt: DataTypes.INTEGER,
  }, { timestamps: false, tableName: 'User', freezeTableName: true });
  const qg = seq.getQueryInterface().queryGenerator as any;
  qg.selectQuery('User', { attributes: ['name'] });
});

await measureHeap('TypeORM', async () => {
  const { EntitySchema } = await import('typeorm');
  new EntitySchema({
    name: 'User', tableName: 'User',
    columns: {
      id: { type: Number, primary: true, generated: true },
      name: { type: String }, email: { type: String },
      companyId: { type: Number }, createdAt: { type: Number },
    },
  } as any);
  // Note: Cannot fully initialize DataSource in Bun (better-sqlite3 unsupported)
  // This measures import + schema definition cost
});

await measureHeap('MikroORM', async () => {
  const { EntitySchema } = await import('@mikro-orm/core');
  new EntitySchema({
    name: 'MikroUser', tableName: 'User',
    properties: {
      id: { type: 'number', primary: true },
      name: { type: 'string' }, email: { type: 'string' },
      companyId: { type: 'number' }, createdAt: { type: 'number' },
    },
  });
  // Note: Cannot fully initialize MikroORM in Bun (better-sqlite3 unsupported)
  // This measures import + schema definition cost
});

await measureHeap('Drizzle', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { pgTable, serial, text, integer } = await import('drizzle-orm/pg-core');
  const users = pgTable('User', {
    id: serial('id').primaryKey(),
    name: text('name').notNull(), email: text('email').notNull(),
    companyId: integer('companyId'), createdAt: integer('createdAt'),
  });
  const db = drizzle({ client: { connect: () => ({}) } as any });
  db.select({ name: users.name }).from(users).toSQL();
});
