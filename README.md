# ⚡ ts-orm-benchmark

What a TypeScript ORM costs per request against a real PostgreSQL.

Each entry runs the same lifecycle - insert, read, update, read, nested read, delete, read - timed per step. `raw pg` and `bun sql` are hand-written SQL with manual row mapping: the floor each ORM is measured against.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

> PostgreSQL 18.4, Node.js v24.18.1, Apple M4 Pro, August 2026. µs per operation, median of 250 interleaved iterations.

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.26.2 · [Prisma](https://www.prisma.io) 7.9.1 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.0 · [MikroORM](https://mikro-orm.io) 7.1.11 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1413 |
| ref | _raw pg_ | floor | 1514 |
| 🥇 1 | **UQL (bunSql)** | +239 | 1652 |
| 🥈 2 | UQL | +269 | 1783 |
| 🥉 3 | Drizzle (bunSql) | +812 | 2225 |
| 4 | Drizzle | +832 | 2346 |
| 5 | TypeORM | +903 | 2417 |
| 6 | Sequelize | +1280 | 2794 |
| 7 | Prisma | +1524 | 3038 |
| 8 | MikroORM | +2286 | 3800 |
<!-- /bench:ranking -->

<!-- bench:headline -->
Totals span 2.3x because every entry pays the same database cost. The part above the floor, which is the ORM's own, spans 10x: 239µs for UQL (bunSql) against 2286µs for MikroORM.
<!-- /bench:headline -->

Each entry is measured against its own driver's floor, so a faster driver is not counted as the ORM's doing. The same UQL code adds 269µs on `pg` and 239µs on Bun SQL: the driver is worth 30µs, the ORM 563µs.

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 536 | 515 | 554 | **552** 🥇 | 761 | 763 | 718 | 700 | 1529 | 690 |
| SELECT with WHERE, SORT, LIMIT 200 | 209 | 272 | **269** 🥇 | 333 | 322 | 381 | 476 | 538 | 388 | 995 |
| UPDATE by id | 148 | 150 | **166** 🥇 | 169 | 204 | 205 | 226 | 355 | 230 | 267 |
| SELECT to verify the update | 82 | 90 | **101** 🥇 | 104 | 124 | 121 | 140 | 145 | 121 | 147 |
| SELECT 50 parents with their children | 224 | 269 | **317** 🥇 | 379 | 541 | 584 | 552 | 750 | 480 | 1356 |
| DELETE by id | 134 | 135 | **149** 🥇 | 150 | 160 | 173 | 182 | 188 | 178 | 224 |
| SELECT to verify the delete | 80 | 83 | **96** 🥇 | **96** 🥇 | 113 | 119 | 123 | 118 | 112 | 121 |
| **Total** | 1413 | 1514 | **1652** 🥇 | 1783 | 2225 | 2346 | 2417 | 2794 | 3038 | 3800 |
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
