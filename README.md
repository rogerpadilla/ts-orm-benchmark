# ⚡ TypeScript ORM Benchmark

What a TypeScript ORM costs per request against a real PostgreSQL.

Each entry runs the same lifecycle - insert, read, update, read, nested read, delete, read - timed per step. `raw pg` and `bun sql` are hand-written SQL with manual row mapping: the floor each ORM is measured against.

I wrote UQL, and it wins here. That is why every step asserts on the rows it returns, why entries are rotated and interleaved, and why each is measured against its own driver's floor. Run it yourself in one command, and [add your own ORM](#adding-an-orm) in four steps.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

<!-- bench:env -->
> PostgreSQL 18.4 (Homebrew), Bun 1.3.14, Apple M4 Pro, August 2026. µs per operation, median of 250 rounds after 125 warmup rounds, interleaved and rotated.
<!-- /bench:env -->

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.28.1 · [Prisma](https://www.prisma.io) 7.9.1 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.0 · [MikroORM](https://mikro-orm.io) 7.1.12 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1228 |
| ref | _raw pg_ | floor | 1309 |
| 🥇 1 | **UQL (bunSql)** | +198 | 1426 |
| 🥈 2 | UQL | +244 | 1553 |
| 🥉 3 | Drizzle (bunSql) | +643 | 1871 |
| 4 | Drizzle | +694 | 2003 |
| 5 | TypeORM | +757 | 2066 |
| 6 | Sequelize | +1045 | 2354 |
| 7 | Prisma | +1275 | 2584 |
| 8 | MikroORM | +2075 | 3384 |
<!-- /bench:ranking -->

Rank is by what an entry adds over its own floor, not by its total, so an entry with a lower total can sit further down when the two floors differ.

<!-- bench:headline -->
Totals span 2.4x because every entry pays the same database cost. The part above the floor, which is the ORM's own, spans 10x: 198µs for UQL (bunSql) against 2075µs for MikroORM.
<!-- /bench:headline -->

<!-- bench:spread -->
Each median above carries a 95% confidence interval of ±2.8% or tighter (widest: raw pg), so the gaps in the ranking are far larger than the measurement.
<!-- /bench:spread -->

<!-- bench:driver -->
Each entry is measured against its own driver's floor, so a faster driver is not counted as the ORM's doing. Moving the same UQL code from `pg` to Bun SQL saves 127µs in total, but only 46µs of that is UQL: the other 81µs is the gap between the two floors, which every entry on that driver gets for free.
<!-- /bench:driver -->

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 441 | 412 | **448** 🥇 | 453 | 608 | 619 | 589 | 570 | 1258 | 551 |
| SELECT with WHERE, SORT, LIMIT 200 | 185 | 237 | **235** 🥇 | 295 | 270 | 322 | 402 | 460 | 322 | 1002 |
| UPDATE by id | 136 | 139 | **152** 🥇 | 155 | 178 | 183 | 202 | 305 | 199 | 242 |
| SELECT to verify the update | 74 | 79 | **90** 🥇 | 94 | 107 | 109 | 128 | 124 | 112 | 131 |
| SELECT 50 parents with their children | 197 | 242 | **282** 🥇 | 334 | 459 | 515 | 474 | 632 | 436 | 1145 |
| DELETE by id | 126 | 125 | **136** 🥇 | 137 | 150 | 151 | 162 | 159 | 158 | 203 |
| SELECT to verify the delete | 69 | 75 | **83** 🥇 | 85 | 99 | 104 | 109 | 104 | 99 | 110 |
| **Total** | 1228 | 1309 | **1426** 🥇 | 1553 | 1871 | 2003 | 2066 | 2354 | 2584 | 3384 |
<!-- /bench:steps -->

The nested read separates the field most, being the only step that loads a relation.

<!-- bench:widest -->
Prisma's insert is the widest single-step gap in the set, 1258µs against 448-619µs for every other entry.
<!-- /bench:widest -->

Prisma is the only entry that wraps its insert in an explicit transaction, worth 88µs when measured on its own. That figure is a one-off, not regenerated with the tables.

## Run it

Needs [Bun](https://bun.sh) and a PostgreSQL you can reach: `bun sql` is a Bun API, so every entry is timed on the same runtime.

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

DATABASE_URL=postgres://localhost:5432/postgres bun run bench
```

It creates its own `ts_orm_bench` database, then rewrites `results.js` and every generated block above.

## Method

- Every step asserts on the rows it returns, so a step that silently does nothing fails instead of scoring well. CI runs the lifecycle with `--verify` on every push.
- Entries are interleaved and rotated, one pass each per round, so none of them keeps a favourable position. Running each to completion made results depend on declaration order.
- Warmup rounds equal to half the measured run come first and are discarded. Below that, per-entry figures swing by hundreds of µs between runs.
- Median per step, never mean, so one GC pause cannot dominate a number.
- One connection each, no pooling.
- Same `Company` and `User` shape for everyone, and each step uses the entry's own idiomatic API: `createManyAndReturn` for Prisma, `insertMany` for UQL, `.returning()` for Drizzle.
- Prisma is the only entry needing codegen. `prisma generate` runs from `postinstall`, and it connects through the `pg` driver adapter.

## What this does not measure

One connection, one machine, one schema shape, one database. Nothing here speaks to:

- Pooling, or behaviour under concurrency
- Memory, cold start, or bundle size
- Joins deeper than the single relation in the nested read
- Transaction throughput
- Any database other than PostgreSQL

An ORM that places last here can still be the right choice on any of those.

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flow-bench.ts` and add it to `ENTRIES` in `scripts/report.ts`
4. Run `bun run bench`; the tables regenerate themselves

## License

[MIT](LICENSE.md)
