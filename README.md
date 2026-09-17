# TypeScript ORM benchmarks

What a TypeScript ORM costs you on one real PostgreSQL round trip, in time and in memory, and which mistakes it catches before you run it.

Every entry runs the same seven-step lifecycle over the same `Company`/`User` schema in its own idiomatic API, measured against hand-written `raw pg` and `bun sql` floors, so what you read is the ORM's cost and not Postgres'. Every tool is also [compiled against the same ordinary mistakes](#type-safety) and [renamed with its own tooling](#rename-safety), and the same lifecycle is [run on Bun, Node and Deno](#runtimes) and [weighed for what it allocates](#memory).

I wrote UQL, so read the tables rather than my summary of them. Clone it and check: that is what the [method](#method) is for.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

<!-- bench:env -->
> PostgreSQL 18.6 (Homebrew), Bun 1.4.2, Apple M4 Max, September 2026. Median µs per operation over 250 rounds, after 125 warmup rounds, interleaved and rotated. Every median is ±2.0% or tighter at 95% confidence.
<!-- /bench:env -->

<!-- bench:versions -->
_Versions: [Drizzle](https://orm.drizzle.team) 0.45.2 · [MikroORM](https://mikro-orm.io) 7.2.0 · [Prisma](https://www.prisma.io) 7.10.0 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.1 · [UQL](https://uql-orm.dev) 0.66.0._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1099 |
| ref | _raw pg_ | floor | 1135 |
| 1 | **UQL (bunSql)** | +239 | 1338 |
| 1 | **UQL** | +260 | 1395 |
| 3 | Drizzle (bunSql) | +365 | 1464 |
| 3 | Drizzle | +408 | 1543 |
| 5 | TypeORM | +509 | 1644 |
| 6 | Sequelize | +822 | 1957 |
| 7 | Prisma | +902 | 2037 |
| 8 | MikroORM | +1519 | 2654 |
<!-- /bench:ranking -->

Places are by `Adds`, not by total, so a lower total can sit further down when the two floors differ. Entries share a place when their confidence intervals overlap: an equal number is a difference this run cannot resolve, not a tie broken in someone's favour.

<!-- bench:headline -->
Totals only span 2.0x, because every entry pays the same database cost. What the ORM itself adds spans 6x: 239µs for UQL (bunSql), 1519µs for MikroORM.

Each entry is measured against its own driver's floor, so a faster driver is never counted as the ORM's win. Running the same UQL code on Bun SQL instead of `pg` saves 57µs, but only 21µs of that is UQL: the other 36µs is the gap between the two floors, free to anything on that driver.
<!-- /bench:headline -->

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Drizzle](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 341 | 325 | **356** | 358 | 400 | 409 | 448 | 446 | 867 | 431 |
| SELECT with WHERE, SORT, LIMIT 200 | 174 | 198 | **217** | 248 | 233 | 255 | 326 | 379 | 275 | 728 |
| SELECT 50 parents with their children | 188 | 214 | **309** | 341 | 358 | 400 | 340 | 532 | 378 | 862 |
| **Total**, all 7 steps | 1099 | 1135 | **1338** | 1395 | 1464 | 1543 | 1644 | 1957 | 2037 | 2654 |
<!-- /bench:steps -->

<!-- bench:steps-note -->
The biggest gap is Prisma's insert: 867µs against 356-448µs for everyone else. The other 4 steps are asserted every round but not published: they are round trips with almost nothing in them, worth 448-633µs of each total and separating the field by at most 100µs.
<!-- /bench:steps-note -->

### The nested read, as each entry writes it

Lifted out of [scripts/flows.ts](scripts/flows.ts) at generation time, so what is shown is what ran; the other six steps are in that file.

<details>
<summary>50 parents with their children, in each entry's own API</summary>

<!-- bench:samples -->
```ts
// bun sql
{
  const rows = (await sql`
    SELECT c.id AS "cId", c.name AS "cName", u.id AS "uId", u.name AS "uName"
    FROM "Company" c LEFT JOIN "User" u ON u."companyId" = c.id
    WHERE c.id <= ${NESTED_LIMIT} ORDER BY c.id
  `) as { cId: number; cName: string; uId: number | null; uName: string | null }[];
  return nestFlatRows(rows);
}

// raw pg
{
  const rows = (
    await db.query(
      `SELECT c.id "cId", c.name "cName", u.id "uId", u.name "uName"
       FROM "${COMPANY_TABLE}" c LEFT JOIN "${USER_TABLE}" u ON u."companyId" = c.id
       WHERE c.id <= $1 ORDER BY c.id`,
      [NESTED_LIMIT],
    )
  ).rows as { cId: number; cName: string; uId: number | null; uName: string | null }[];
  return nestFlatRows(rows);
}

// Drizzle, Drizzle (bunSql)
db.query.Company.findMany({
  columns: { id: true, name: true },
  with: { users: { columns: { id: true, name: true } } },
  where: (t, { lte }) => lte(t.id, NESTED_LIMIT),
  orderBy: (t, { asc: a }) => a(t.id),
})

// MikroORM
fork().find(
  MikroCompanySchema,
  { id: { $lte: NESTED_LIMIT } },
  { fields: ['id', 'name', 'users.id', 'users.name'], populate: ['users'], orderBy: { id: 'ASC' } },
)

// Prisma
db.company.findMany({
  select: { id: true, name: true, users: { select: { id: true, name: true } } },
  where: { id: { lte: NESTED_LIMIT } },
  orderBy: { id: 'asc' },
})

// Sequelize
SqCompany.findAll({
  attributes: ['id', 'name'],
  include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
  where: { id: { [Op.lte]: NESTED_LIMIT } },
  order: [['id', 'ASC']],
})

// TypeORM
companies.find({
  select: { id: true, name: true, users: { id: true, name: true } },
  relations: { users: true },
  where: { id: LessThanOrEqual(NESTED_LIMIT) },
  order: { id: 'ASC' },
})

// UQL, UQL (bunSql)
q.findMany(Company, {
  $select: { id: true, name: true },
  $populate: { users: { $select: { id: true, name: true } } },
  $where: { id: { $lte: NESTED_LIMIT } },
  $sort: { id: 1 },
})
```
<!-- /bench:samples -->

</details>

## Type safety

What an ORM costs when you get a column name wrong. Ordinary mistakes, written in each tool's own API in [type-safety/](type-safety/) and compiled to see whether the compiler objects.

<!-- bench:type-safety-env -->
> Checked with TypeScript 7.0.2, 11 probes per entry.
<!-- /bench:type-safety-env -->

<!-- bench:type-safety -->
| Mistake | [Drizzle](https://orm.drizzle.team) | [MikroORM](https://mikro-orm.io) | [Prisma](https://www.prisma.io) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [UQL](https://uql-orm.dev) |
| --- | --- | --- | --- | --- | --- | --- |
| Misspelled column in the projection | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Misspelled column in the filter | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| String value against a numeric column | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Text operator against a numeric column | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Misspelled column in the sort | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Sum over a text column | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| Misspelled column inside a loaded relation | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Misspelled column in inserted data | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Number written into a text column | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reading a column the projection left out | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Reading a misspelled column off a loaded relation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Caught**, of 11 | 9 | 9 | 10 | 5 | 10 | **11** |
<!-- /bench:type-safety -->

<!-- bench:type-safety-note -->
UQL catches 11 of the 11, Sequelize 5. Every mistake here is caught by at least one entry. The corrected copy of every file compiles clean, which is what makes a red mark a missing check rather than a broken query.
<!-- /bench:type-safety-note -->

Prisma's red mark on the first row is the compiler's doing: TypeScript 6.0 stopped reporting excess properties on an object literal checked against a mapped type over an inferred type parameter, and 7 inherits it.

```ts
type Subset<T, U> = { [K in keyof T]: K extends keyof U ? T[K] : never };
declare function findMany<T extends Args>(args: Subset<T, Args>): T;
findMany({ select: { id: true, emial: true } }); // 5.9.3 errors; 6.0.3 and 7.0.2 are silent
```

Counted as missing, not excused: a check the compiler no longer makes protects nobody. Drizzle's `db.query` loses it the same way, which is why its flat probes use `db.select()`, the builder its timed read uses: a misspelling there is a property access, and those are still caught.

## Rename safety

What an ORM costs when you rename a field. Each entry's model and every place that names three of its members are in [rename-safety/](rename-safety/), written the most rename-friendly way its API allows, then renamed with that tool's own rename: TypeScript's language server, or Prisma's for its schema. For TypeORM that way is its decorators, whose inverse side takes a callback where an entity schema takes a string; they need `experimentalDecorators`, which UQL's standard decorators cannot share a project with, so [rename-safety/typeorm/](rename-safety/typeorm/) has its own. A rename takes the column with the field, which is what every entry maps by default; Prisma's server also adds `@map` to keep the old column, and that edit is left out.

[uql-orm.dev/rename-safety](https://uql-orm.dev/rename-safety) shows these files and renames them live, in the same editor tabs as its type-safety page.

<!-- bench:rename-safety-env -->
> Renamed `emailAddress` to `email`, `employerId` to `workplaceId` and `employer` to `workplace`, with TypeScript 7.0.2 and prisma-language-server 31.12.10.
<!-- /bench:rename-safety-env -->

<!-- bench:rename-safety -->
| Mention | [Drizzle](https://orm.drizzle.team) | [MikroORM](https://mikro-orm.io) | [Prisma](https://www.prisma.io) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [UQL](https://uql-orm.dev) |
| --- | --- | --- | --- | --- | --- | --- |
| **Definitions** |  |  |  |  |  |  |
| Index on the field | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| Composite unique index | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| Covering index column | - | ⚠️ | - | - | - | ✅ |
| Foreign key of a relation | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Inverse side of a relation | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **SQL in definitions** |  |  |  |  |  |  |
| Expression index | ✅ | ⚠️ | - | ❌ | - | ✅ |
| Partial index condition | ✅ | ⚠️ | - | ❌ | ❌ | ✅ |
| Check constraint | ✅ | ⚠️ | - | - | ❌ | ✅ |
| Generated column | ✅ | ❌ | - | - | ❌ | ✅ |
| **Queries** |  |  |  |  |  |  |
| Field in the projection | ✅ | ⚠️ | ❌ | ❌ | ✅ | ✅ |
| Field in the filter | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ |
| Field in the sort | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |
| Field inside a loaded relation | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |
| Relation loaded by name | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |
| Field in inserted data | ⚠️ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| Field in updated data | ⚠️ | ⚠️ | ❌ | ✅ | ✅ | ✅ |
| Foreign key in a grouped count | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ✅ |
| Field read off the result | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| **Raw SQL in a query** |  |  |  |  |  |  |
| Raw SQL in a filter | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Followed** | 14 | 3 | 4 | 4 | 12 | 19 |
| **Flagged by the compiler** | 4 | 13 | 7 | 0 | 0 | 0 |
| **Silently left behind** | 0 | 3 | 3 | 12 | 5 | 0 |
<!-- /bench:rename-safety -->

<!-- bench:rename-safety-note -->
Drizzle and UQL leave nothing behind silently; Sequelize leaves 12 of the 19. A mention left behind silently still compiles, and breaks when the code runs or the schema migrates.
<!-- /bench:rename-safety-note -->

✅ the rename edited it. ⚠️ it was left behind and the renamed code no longer compiles there. ❌ it was left behind and still compiles, so it breaks at run time or in the next migration. `-` the entry has no way to declare it.

## Runtimes

Same lifecycle, three runtimes, one bundle built by Bun so the runtime is the only variable. All three measure the same entries. The `(bunSql)` rows sit out even on Bun: that client is a Bun API, and three extra entries per round would show up in the tail as if the runtime had caused it.

<!-- bench:runtime-env -->
> Bun 1.4.2, Node 24.20.0, Deno 2.9.6, all running the same bundled JavaScript, one at a time against the same database. PostgreSQL 18.6 (Homebrew), Apple M4 Max, September 2026. µs for a whole lifecycle, nearest-rank percentiles over 2000 rounds after 250 warmup, so a p99 is drawn from the 21 slowest rounds.
<!-- /bench:runtime-env -->

<!-- bench:runtimes -->
| Entry (µs) | Bun p50 | Bun p99 | Node p50 | Node p99 | Deno p50 | Deno p99 |
| --- | --- | --- | --- | --- | --- | --- |
| [raw pg](https://node-postgres.com) | **1127** | **2876** | 1216 | 3691 | 1240 | 5222 |
| [UQL](https://uql-orm.dev) | **1398** | **4028** | 1471 | 4819 | 1486 | 5986 |
| [Drizzle](https://orm.drizzle.team) | **1508** | **3470** | 1715 | 5728 | 1741 | 6564 |
| [TypeORM](https://typeorm.io) | **1564** | **5239** | 1751 | 6702 | 1694 | 6333 |
| [Sequelize](https://sequelize.org) | **1856** | **5760** | 2085 | 6902 | 2130 | 7564 |
| [Prisma](https://www.prisma.io) | **1929** | **4982** | 2224 | 6815 | 2439 | 9706 |
| [MikroORM](https://mikro-orm.io) | **2561** | **9155** | 3746 | 11143 | 3851 | 11665 |
<!-- /bench:runtimes -->

<!-- bench:runtime-note -->
On `raw pg`, the same code on all of them, the runtimes are 113µs apart at p50 but 2346µs apart at p99: Bun leads both, and each p99 is 155% on Bun, 204% on Node, 321% on Deno above its own p50. Switching runtime moves any single entry by at most 1290µs at p50 (MikroORM), where switching ORM on one runtime moves it 1139-2334µs, so the runtime is the bigger decision here. The one pair that changes places between runtimes is Drizzle and TypeORM, 34µs apart.
<!-- /bench:runtime-note -->

## Memory

How much heap each entry allocates to serve one lifecycle. Measured on Node, one process per entry: V8's counter is the only one of the three that moves on allocation rather than at a collection, and on Bun a hundred thousand fresh objects read as zero bytes. The `(bunSql)` rows sit out for the same reason the runtime table drops them.

<!-- bench:memory-env -->
> PostgreSQL 18.6 (Homebrew), Node 24.20.0, Apple M4 Max, September 2026. Median KB allocated per step over 60 rounds after 60 warmup of a 7-step lifecycle. Rounds a garbage collection ran in are discarded, never corrected, and no entry lost more than 1% of its own (MikroORM).
<!-- /bench:memory-env -->

<!-- bench:memory -->
| Entry | insert | read | nested | Total KB | Adds KB |
| --- | --- | --- | --- | --- | --- |
| _[raw pg](https://node-postgres.com)_ | 14 | 87 | 106 | 245 | floor |
| [UQL](https://uql-orm.dev) | 46 | 104 | 81 | 318 | **+73** |
| [Drizzle](https://orm.drizzle.team) | 140 | 251 | 242 | 769 | +524 |
| [Prisma](https://www.prisma.io) | 273 | 220 | 373 | 1054 | +809 |
| [TypeORM](https://typeorm.io) | 126 | 295 | 503 | 1066 | +821 |
| [Sequelize](https://sequelize.org) | 100 | 426 | 591 | 1295 | +1050 |
| [MikroORM](https://mikro-orm.io) | 77 | 1470 | 2059 | 3865 | +3620 |
<!-- /bench:memory -->

<!-- bench:memory-note -->
Above the floor the field spans 49.6x: 73KB for UQL, 3620KB for MikroORM, and nested opens it widest: MikroORM's 2059KB against UQL's 81KB.

Almost none of it survives: another 60 lifecycles, collected either side, leave at most 39KB behind (Sequelize), identity maps included. What the table prices is collector pressure, not a resident set that grows.
<!-- /bench:memory-note -->

## Method

- PostgreSQL runs natively, never in a container: a VM between client and server puts its latency into `Adds` instead of cancelling against the floor.
- One connection each, no pooling, and each entry on its own idiomatic API: `.returning()` for Drizzle, `em.find` for MikroORM, `createManyAndReturn` for Prisma, `insertMany` for UQL. MikroORM gets a fresh `em.fork()` per operation, as its [identity-map docs](https://mikro-orm.io/docs/identity-map) call for, so no Unit-of-Work state piles up across the run. Its insert is the one step on `createQueryBuilder`: `em.insertMany` emits the same single `INSERT ... RETURNING "id"` but returns only the first id, so the step could not assert all ten rows through it. Only Prisma needs codegen, and it reaches Postgres through the `pg` adapter like the rest.
- Entity definitions are each ORM's current API: MikroORM 7 keeps its decorators in a separate package this does not install, and TypeORM's need `experimentalDecorators`, which UQL's standard decorators cannot share. Built once at startup, off the query path.
- Timed and scored through the same API, at `strict`, against the same entities and the same columns. Drizzle reaches its flat reads through `db.select()` and its nested read through `db.query`, in both halves, because those are the APIs its version offers for each job.
- The nested read is one statement for Drizzle, Sequelize, TypeORM and UQL, and two for MikroORM and Prisma, which select the parents and then the children by `IN`. Postgres is local here, so the second round trip is cheap; over a network it would not be, and the split-query entries would lose ground. UQL has Postgres build the children as JSON, so its client reads 50 rows where the floor's join reads 200.
- Entries are interleaved and rotated, one pass each per round, so no entry keeps a favourable position. Warmup is half the run, capped at 250 rounds, and discarded.
- All seven steps assert on the rows they return, every round, though only three are published: a step that quietly does nothing fails instead of winning. CI runs `--verify` on every push.
- Medians per step, never means, so one GC pause cannot decide a number. Percentiles are of the round total, so a p99 is one slow lifecycle rather than seven unrelated slow operations.
- Deno gets an import map pinned to the installed versions, since it resolves npm itself: all three runtimes load the same libraries, not the same ranges.
- The memory benchmark inverts two of those: a process per entry, since a shared heap cannot be attributed, and no forced collection, since collecting frees compiled code and the rounds after it re-tier.

## What this does not measure

One connection, one machine, one schema, one database. Nothing here speaks to pooling or concurrency, HTTP and SSR, cold start, bundle size, transaction throughput, joins deeper than the nested read's single relation, or any database but PostgreSQL. Nor to migrations, tooling, ecosystem, or how pleasant any of it is to live with. The memory table is allocation per request, not resident set: what an idle process holds it does not measure.

An ORM that places last here can still be the right call on any of those.

## Run it

You need [Bun](https://bun.sh) and a PostgreSQL you can reach. Node and Deno only need to be installed; whichever are found get a column.

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

export DATABASE_URL=postgres://localhost:5432/postgres
bun run bench
bun run bench.runtimes
bun run bench.memory
bun run bench.types
```

Each rewrites the tables it owns, and none needs the others to have run. Every block they write also lands in `report.json`, for anyone rendering these numbers elsewhere.

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flows.ts`, wire them into `FLOWS`, and add it to `ENTRIES` and `TOOLS` in `scripts/model.ts`. `TOOLS` is where its link, version and probe file name come from
4. Declare its client in `type-safety/clients.ts` and write the probes of `scripts/probes.ts` in `type-safety/<probe>.ts`
5. Run `bun run bench`, `bun run bench.runtimes`, `bun run bench.memory` and `bun run bench.types`; the tables regenerate themselves

## License

[MIT](LICENSE.md)
