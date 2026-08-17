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
| ref | _bun sql_ | floor | 1163 |
| ref | _raw pg_ | floor | 1250 |
| 🥇 1 | **UQL (bunSql)** | +199 | 1362 |
| 🥈 2 | UQL | +246 | 1496 |
| 🥉 3 | Drizzle (bunSql) | +598 | 1761 |
| 4 | Drizzle | +635 | 1885 |
| 5 | TypeORM | +675 | 1925 |
| 6 | Sequelize | +1021 | 2271 |
| 7 | Prisma | +1218 | 2468 |
| 8 | MikroORM | +1968 | 3218 |
<!-- /bench:ranking -->

Rank is by what an entry adds over its own floor, not by its total, so an entry with a lower total can sit further down when the two floors differ.

<!-- bench:headline -->
Totals span 2.4x because every entry pays the same database cost. The part above the floor, which is the ORM's own, spans 10x: 199µs for UQL (bunSql) against 1968µs for MikroORM.
<!-- /bench:headline -->

<!-- bench:spread -->
Each median above carries a 95% confidence interval of ±1.9% or tighter (widest: Sequelize), so the gaps in the ranking are far larger than the measurement.
<!-- /bench:spread -->

<!-- bench:driver -->
Each entry is measured against its own driver's floor, so a faster driver is not counted as the ORM's doing. Moving the same UQL code from `pg` to Bun SQL saves 134µs in total, but only 47µs of that is UQL: the other 87µs is the gap between the two floors, which every entry on that driver gets for free.
<!-- /bench:driver -->

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 398 | 378 | **409** 🥇 | 423 | 558 | 572 | 535 | 534 | 1202 | 508 |
| SELECT with WHERE, SORT, LIMIT 200 | 179 | 225 | **218** 🥇 | 281 | 261 | 302 | 379 | 446 | 300 | 946 |
| UPDATE by id | 133 | 134 | 150 | **148** 🥇 | 171 | 174 | 190 | 286 | 189 | 252 |
| SELECT to verify the update | 71 | 77 | **88** 🥇 | 90 | 106 | 107 | 116 | 122 | 105 | 120 |
| SELECT 50 parents with their children | 189 | 240 | **277** 🥇 | 336 | 423 | 486 | 456 | 623 | 420 | 1086 |
| DELETE by id | 125 | 124 | 136 | **134** 🥇 | 146 | 146 | 150 | 155 | 153 | 203 |
| SELECT to verify the delete | 68 | 72 | **84** 🥇 | **84** 🥇 | 96 | 98 | 99 | 105 | 99 | 103 |
| **Total** | 1163 | 1250 | **1362** 🥇 | 1496 | 1761 | 1885 | 1925 | 2271 | 2468 | 3218 |
<!-- /bench:steps -->

The nested read separates the field most, being the only step that loads a relation.

<!-- bench:widest -->
Prisma's insert is the widest single-step gap in the set, 1202µs against 409-572µs for every other entry.
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
