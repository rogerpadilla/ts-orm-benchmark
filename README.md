# ⚡ ts-orm-benchmark

What a TypeScript ORM costs per request against a real PostgreSQL.

Each entry runs the same lifecycle - insert, read, update, read, nested read, delete, read - timed per step. `raw pg` and `bun sql` are hand-written SQL with manual row mapping: the floor each ORM is measured against.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

> PostgreSQL 18.4, Node.js v24.18.1, Apple M4 Pro, August 2026. µs per operation, median of 250 interleaved iterations.

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.26.0 · [Prisma](https://www.prisma.io) 7.9.1 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.0 · [MikroORM](https://mikro-orm.io) 7.1.11 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1208 |
| ref | _raw pg_ | floor | 1298 |
| 🥇 1 | **UQL (bunSql)** | +273 | 1481 |
| 🥈 2 | UQL | +334 | 1632 |
| 🥉 3 | Drizzle (bunSql) | +650 | 1858 |
| 4 | Drizzle | +679 | 1977 |
| 5 | TypeORM | +752 | 2050 |
| 6 | Sequelize | +1102 | 2400 |
| 7 | Prisma | +1279 | 2577 |
| 8 | MikroORM | +1942 | 3240 |
<!-- /bench:ranking -->

<!-- bench:headline -->
Totals span 2.2x because every entry pays the same database cost. The part above the floor, which is the ORM's own, spans 7x: 273µs for UQL (bunSql) against 1942µs for MikroORM.
<!-- /bench:headline -->

Each entry is measured against its own driver's floor, so a faster driver is not counted as the ORM's doing. The same UQL code adds 334µs on `pg` and 273µs on Bun SQL: the driver is worth 61µs, the ORM 345µs.

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 423 | 403 | **437** 🥇 | 449 | 593 | 603 | 575 | 588 | 1257 | 546 |
| SELECT with WHERE, SORT, LIMIT 200 | 186 | 238 | **235** 🥇 | 296 | 275 | 323 | 403 | 473 | 327 | 854 |
| UPDATE by id | 134 | 136 | **151** 🥇 | 152 | 175 | 181 | 200 | 302 | 197 | 254 |
| SELECT to verify the update | 73 | 78 | **91** 🥇 | 93 | 107 | 110 | 123 | 124 | 108 | 124 |
| SELECT 50 parents with their children | 197 | 244 | **283** 🥇 | 340 | 461 | 510 | 479 | 648 | 433 | 1155 |
| DELETE by id | 125 | 125 | 216 | 220 | 149 | **148** 🥇 | 160 | 159 | 156 | 202 |
| SELECT to verify the delete | 70 | 74 | **68** 🥇 | 82 | 98 | 102 | 110 | 106 | 99 | 105 |
| **Total** | 1208 | 1298 | **1481** 🥇 | 1632 | 1858 | 1977 | 2050 | 2400 | 2577 | 3240 |
<!-- /bench:steps -->

The nested read separates the field most, being the only step that loads a relation.

UQL is last on `delete`: `deleteMany` resolves the matching ids before deleting, and nothing here needs them, so it spends two statements on one row.

Prisma's insert is the widest single-step gap in the set, 1257µs against 546-603µs for the other ORMs. It wraps the batch in an explicit transaction, worth 88µs of that.

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
