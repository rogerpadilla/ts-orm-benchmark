# ⚡ ts-orm-benchmark

What a TypeScript ORM costs per request against a real PostgreSQL.

Each entry runs the same lifecycle - insert, read, update, read, nested read, delete, read - timed per step. `raw pg` and `bun sql` are hand-written SQL with manual row mapping: the floor each ORM is measured against.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊

## Results

> PostgreSQL 18.4, Node.js v24.18.1, Apple Silicon M-series, August 2026. µs per operation, median of 250 interleaved iterations.

<!-- bench:ranking -->
| P | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1205 |
| ref | _raw pg_ | floor | 1300 |
| 🥇 1 | **UQL (bunSql)** | +278 | 1483 |
| 🥈 2 | UQL | +333 | 1633 |
| 🥉 3 | Drizzle (bunSql) | +621 | 1826 |
| 4 | Drizzle | +643 | 1943 |
| 5 | TypeORM | +791 | 2091 |
| 6 | Sequelize | +1086 | 2386 |
| 7 | Prisma | +1271 | 2571 |
| 8 | MikroORM | +1889 | 3189 |
<!-- /bench:ranking -->

<!-- bench:headline -->
Totals span 2.2x because every entry pays the same database cost. The part above the floor, which is the ORM's own, spans 7x: 278µs for UQL (bunSql) against 1889µs for MikroORM.
<!-- /bench:headline -->

A Bun SQL entry is measured against the `bun sql` floor, everything else against `raw pg`, so a faster driver is not counted as the ORM's doing. The same UQL code adds 333µs on `pg` and 278µs on Bun SQL, which is roughly the distance between first and second place.

### Per step

<!-- bench:steps -->
| Operation (µs) | [raw pg](https://node-postgres.com) | [bun sql](https://bun.sh/docs/api/sql) | [UQL](https://uql-orm.dev) | [UQL (bunSql)](https://uql-orm.dev) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [MikroORM](https://mikro-orm.io) | [Drizzle](https://orm.drizzle.team) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Prisma](https://www.prisma.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 404 | 426 | 445 | **437** 🥇 | 571 | 591 | 550 | 577 | 567 | 1241 |
| SELECT with WHERE, SORT, LIMIT 200 | 241 | 184 | 297 | **232** 🥇 | 470 | 411 | 839 | 322 | 275 | 323 |
| UPDATE by id | 137 | 136 | **153** 🥇 | **153** 🥇 | 302 | 203 | 230 | 182 | 176 | 203 |
| SELECT to verify the update | 78 | 72 | 93 | **91** 🥇 | 123 | 124 | 124 | 109 | 107 | 109 |
| SELECT 50 parents with their children | 242 | 193 | 343 | **283** 🥇 | 651 | 489 | 1149 | 503 | 453 | 435 |
| DELETE by id | 125 | 125 | 221 | 218 | 163 | 163 | 192 | **148** 🥇 | 150 | 160 |
| SELECT to verify the delete | 73 | 69 | 81 | **69** 🥇 | 106 | 110 | 105 | 102 | 98 | 100 |
| **Total** | 1300 | 1205 | 1633 | **1483** 🥇 | 2386 | 2091 | 3189 | 1943 | 1826 | 2571 |
<!-- /bench:steps -->

The nested read is where the field separates: it is the only step exercising relation loading. UQL's weakest is `delete`, where `deleteMany` resolves the matching ids before deleting and nothing here needs them, so it spends two statements on one row. Prisma's `createManyAndReturn` wraps its insert in a transaction, which is most of its 1241µs.

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

## Versions

| Entry | Version |
| --- | --- |
| [UQL](https://uql-orm.dev) | 0.25.1 |
| [Prisma](https://www.prisma.io) | 7.9.1 |
| [Sequelize](https://sequelize.org) | 6.37.8 |
| [TypeORM](https://typeorm.io) | 1.1.0 |
| [MikroORM](https://mikro-orm.io) | 7.1.11 |
| [Drizzle](https://orm.drizzle.team) | 0.45.2 |

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flow-bench.ts` and add it to `ENTRIES` in `scripts/report.ts`
4. Run `npm run bench`; the tables regenerate themselves

## License

MIT
