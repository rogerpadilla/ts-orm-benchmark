# ⚡ TypeScript ORM Benchmark

What a TypeScript ORM costs you on one real PostgreSQL round trip.

Every entry runs the same seven-step lifecycle - insert, read, update, read, nested read, delete, read - on the same schema. `raw pg` and `bun sql` are hand-written SQL with manual row mapping: the floor each ORM is measured against, so the figure you read is the ORM's own cost and not Postgres'. The same lifecycle also runs on [Bun, Node and Deno](#runtimes).

I wrote UQL, and it wins here. The [method](#method) is built so you don't have to take my word for it. Clone it and check.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

<!-- bench:env -->
> PostgreSQL 18.6 (Homebrew), Bun 1.3.14, Apple M4 Pro, August 2026. Median µs per operation over 250 rounds, after 125 warmup rounds, interleaved and rotated. Every median is ±2.5% or tighter at 95% confidence (widest: bun sql).
<!-- /bench:env -->

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.30.0 · [Prisma](https://www.prisma.io) 7.9.1 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.0 · [MikroORM](https://mikro-orm.io) 7.1.13 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1233 |
| ref | _raw pg_ | floor | 1330 |
| 🥇 1 | **UQL (bunSql)** | +218 | 1451 |
| 🥈 2 | UQL | +239 | 1569 |
| 🥉 3 | Drizzle (bunSql) | +663 | 1896 |
| 4 | Drizzle | +679 | 2009 |
| 5 | TypeORM | +775 | 2105 |
| 6 | Sequelize | +1086 | 2416 |
| 7 | Prisma | +1249 | 2579 |
| 8 | MikroORM | +2003 | 3333 |
<!-- /bench:ranking -->

Rank is by `Adds`, not by total, so a lower total can sit further down when the two floors differ.

<!-- bench:headline -->
Totals only span 2.3x, because every entry pays the same database cost. What the ORM itself adds spans 9x: 218µs for UQL (bunSql), 2003µs for MikroORM.

Each entry is measured against its own driver's floor, so a faster driver is never counted as the ORM's win. Running the same UQL code on Bun SQL instead of `pg` saves 118µs, but only 21µs of that is UQL: the other 97µs is the gap between the two floors, free to anything on that driver.
<!-- /bench:headline -->

### Per step

The three steps where the amount of data bound and hydrated decides the number.

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 440 | 428 | **462** 🥇 | 466 | 621 | 624 | 616 | 592 | 1257 | 574 |
| SELECT with WHERE, SORT, LIMIT 200 | 188 | 240 | **242** 🥇 | 299 | 275 | 324 | 406 | 467 | 322 | 991 |
| SELECT 50 parents with their children | 199 | 241 | **282** 🥇 | 333 | 463 | 512 | 478 | 656 | 431 | 1111 |
| **Total**, all 7 steps | 1233 | 1330 | **1451** 🥇 | 1569 | 1896 | 2009 | 2105 | 2416 | 2579 | 3333 |
<!-- /bench:steps -->

<!-- bench:steps-note -->
The biggest gap is Prisma's insert: 1257µs against 462-624µs for everyone else. The other 4 steps are asserted every round but not published: they are round trips with almost nothing in them, worth 465-701µs of each total and separating the field by at most 156µs.
<!-- /bench:steps-note -->

Prisma is also the only entry that wraps its insert in a transaction, worth 88µs on its own. Hand-checked, not regenerated with the tables.

## Runtimes

Same lifecycle, three runtimes, one bundle built by Bun so the runtime is the only variable. All three measure the same seven entries: the `(bunSql)` rows sit out even on Bun, because that client is a Bun API and three extra entries per round would show up in the tail as if the runtime had caused it.

<!-- bench:runtime-env -->
> Bun 1.3.14, Node 24.18.1, Deno 2.9.5, all running the same bundled JavaScript, one at a time against the same database. PostgreSQL 18.6 (Homebrew), Apple M4 Pro, August 2026. µs for a whole lifecycle, nearest-rank percentiles over 2000 rounds after 250 warmup, so a p99 is drawn from the 21 slowest rounds.
<!-- /bench:runtime-env -->

<!-- bench:runtimes -->
| Entry (µs) | Bun p50 | Bun p99 | Node p50 | Node p99 | Deno p50 | Deno p99 |
| --- | --- | --- | --- | --- | --- | --- |
| [raw pg](https://node-postgres.com) | 1394 | 4956 | **1342** | 2610 | 1354 | **2436** |
| [UQL](https://uql-orm.dev) | 1652 | 5578 | 1610 | 3668 | **1560** | **3489** |
| [TypeORM](https://typeorm.io) | 2146 | 6048 | 2087 | 4685 | **1934** | **4616** |
| [Drizzle](https://orm.drizzle.team) | 2169 | 6114 | 1938 | 4004 | **1896** | **3444** |
| [Sequelize](https://sequelize.org) | 2521 | 6361 | 2431 | **5326** | **2354** | 5564 |
| [Prisma](https://www.prisma.io) | **2638** | 7754 | 2720 | **5166** | 2854 | 5192 |
| [MikroORM](https://mikro-orm.io) | **3581** | 10084 | 4379 | **8344** | 4379 | 9201 |
<!-- /bench:runtimes -->

<!-- bench:runtime-note -->
On `raw pg`, the same code on all of them, the runtimes are 52µs apart at p50 but 2520µs apart at p99: Node leads the median, Deno the tail, and each p99 is 256% on Bun, 94% on Node, 80% on Deno above its own p50. Switching runtime moves any single entry by at most 798µs at p50 (MikroORM), where switching ORM on one runtime moves it 1791-2752µs, so the ORM is the bigger decision here. The one pair that changes places between runtimes is TypeORM and Drizzle, 26µs apart.
<!-- /bench:runtime-note -->

## Run it

You need [Bun](https://bun.sh) and a PostgreSQL you can reach. Node and Deno need nothing but to be installed; whichever of the three are found get a column.

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

DATABASE_URL=postgres://localhost:5432/postgres bun run bench
DATABASE_URL=postgres://localhost:5432/postgres bun run bench.runtimes
```

`bench` creates its own `ts_orm_bench` database and rewrites the tables above; `bench.runtimes` rewrites the runtime table.

## Method

- All seven steps assert on the rows they return, every round, though only three are published as timings: a step that quietly does nothing fails instead of winning. CI runs the lifecycle with `--verify` on every push.
- Entries are interleaved and rotated, one pass each per round. Running each to completion made the results depend on declaration order.
- Warmup is half the run, capped at 250 rounds, and discarded. Below that the figures swing by hundreds of µs.
- Medians per step, never means, so one GC pause cannot decide a number. Percentiles are of the round total, so a p99 is one slow lifecycle and not seven unrelated slow operations.
- One connection each, no pooling, and every entry uses its own idiomatic API: `createManyAndReturn` for Prisma, `insertMany` for UQL, `.returning()` for Drizzle. Prisma is the only one needing codegen, and it connects through the `pg` adapter like the rest.
- Deno resolves npm for itself, so it gets an import map pinned to the installed versions: all three runtimes load the same libraries, not the same version ranges.

## What this does not measure

One connection, one machine, one schema, one database. Nothing here speaks to:

- Pooling, or behaviour under concurrency
- HTTP or SSR, which is where a runtime comparison usually lands
- Memory, cold start, or bundle size
- Joins deeper than the single relation in the nested read
- Transaction throughput
- Any database other than PostgreSQL

An ORM that places last here can still be the right call on any of those.

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flows.ts`, wire them into `FLOWS`, and add it to `ENTRIES` in `scripts/model.ts`
4. Run `bun run bench`; the tables regenerate themselves

## License

[MIT](LICENSE.md)
