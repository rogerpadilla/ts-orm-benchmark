# ⚡ ts-orm-benchmark

What a TypeScript ORM costs per request against a real PostgreSQL.

Each entry runs the same lifecycle - insert, read, update, read, nested read, delete, read - timed per step. `raw pg` and `bun sql` are hand-written SQL with manual row mapping: the floor each ORM is measured against.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

> PostgreSQL 18.4, Node.js v24.18.1, Apple M4 Pro, August 2026. µs per operation, median of 250 interleaved iterations.

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.26.3 · [Prisma](https://www.prisma.io) 7.9.1 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.0 · [MikroORM](https://mikro-orm.io) 7.1.11 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1295 |
| ref | _raw pg_ | floor | 1389 |
| 🥇 1 | **UQL (bunSql)** | +206 | 1501 |
| 🥈 2 | UQL | +232 | 1621 |
| 🥉 3 | Drizzle (bunSql) | +644 | 1939 |
| 4 | Drizzle | +685 | 2074 |
| 5 | TypeORM | +838 | 2227 |
| 6 | Sequelize | +1185 | 2574 |
| 7 | Prisma | +1345 | 2734 |
| 8 | MikroORM | +2236 | 3625 |
<!-- /bench:ranking -->

<!-- bench:headline -->
Totals span 2.4x because every entry pays the same database cost. The part above the floor, which is the ORM's own, spans 11x: 206µs for UQL (bunSql) against 2236µs for MikroORM.
<!-- /bench:headline -->

Each entry is measured against its own driver's floor, so a faster driver is not counted as the ORM's doing. The same UQL code adds 269µs on `pg` and 239µs on Bun SQL: the driver is worth 30µs, the ORM 563µs.

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 478 | 454 | **484** 🥇 | 488 | 631 | 635 | 668 | 643 | 1366 | 625 |
| SELECT with WHERE, SORT, LIMIT 200 | 193 | 251 | **245** 🥇 | 309 | 276 | 340 | 436 | 498 | 339 | 1044 |
| UPDATE by id | 140 | 139 | **158** 🥇 | 159 | 184 | 189 | 215 | 337 | 212 | 277 |
| SELECT to verify the update | 77 | 82 | 95 | **93** 🥇 | 110 | 111 | 128 | 130 | 110 | 135 |
| SELECT 50 parents with their children | 204 | 256 | **291** 🥇 | 346 | 478 | 535 | 498 | 680 | 440 | 1205 |
| DELETE by id | 130 | 130 | 142 | **140** 🥇 | 156 | 158 | 170 | 174 | 166 | 222 |
| SELECT to verify the delete | 73 | 77 | **86** 🥇 | **86** 🥇 | 104 | 106 | 112 | 112 | 101 | 117 |
| **Total** | 1295 | 1389 | **1501** 🥇 | 1621 | 1939 | 2074 | 2227 | 2574 | 2734 | 3625 |
<!-- /bench:steps -->

The nested read separates the field most, being the only step that loads a relation.

Prisma's insert is the widest single-step gap in the set, 1529µs against 690-763µs for the other ORMs. It wraps the batch in an explicit transaction, worth 88µs of that.

## Run it

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

DATABASE_URL=postgres:///postgres npm run bench
```

It creates its own `ts_orm_bench` database, then rewrites `results.js` and the tables above.

## Method

- Every step asserts on the rows it returns, so a step that silently does nothing fails instead of scoring well. CI runs the lifecycle with `--verify` on every push.
- Entries are interleaved and rotated, one pass each per round, so none of them keeps a favourable position. Running each to completion made results depend on declaration order.
- One connection each, no pooling.
- Same `Company` and `User` shape for everyone, and each step uses the entry's own idiomatic API: `createManyAndReturn` for Prisma, `insertMany` for UQL, `.returning()` for Drizzle.
- Prisma is the only entry needing codegen. `prisma generate` runs from `postinstall`, and it connects through the `pg` driver adapter.

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flow-bench.ts` and add it to `ENTRIES` in `scripts/report.ts`
4. Run `npm run bench`; the tables regenerate themselves

## License

MIT
