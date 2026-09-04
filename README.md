# ⚡ TypeScript ORM Benchmark

What a TypeScript ORM costs you on one real PostgreSQL round trip, in time and in memory, and which mistakes it catches before you run it.

Every entry runs the same seven-step lifecycle over the same `Company`/`User` schema in its own idiomatic API, measured against hand-written `raw pg` and `bun sql` floors, so what you read is the ORM's cost and not Postgres'. The same lifecycle is [weighed for what it allocates](#memory) and run on [Bun, Node and Deno](#runtimes); the six ORMs are also [compiled against ten ordinary mistakes](#type-safety).

I wrote UQL, so read the tables rather than my summary of them. Clone it and check: that is what the [method](#method) is for.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

<!-- bench:env -->
> PostgreSQL 18.6 (Homebrew), Bun 1.3.14, Apple M4 Max, September 2026. Median µs per operation over 250 rounds, after 125 warmup rounds, interleaved and rotated. Every median is ±3.0% or tighter at 95% confidence (widest: UQL).
<!-- /bench:env -->

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.37.1 · [Prisma](https://www.prisma.io) 7.10.0 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.1 · [MikroORM](https://mikro-orm.io) 7.1.15 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1088 |
| ref | _raw pg_ | floor | 1177 |
| 🥇 1 | **UQL (bunSql)** | +199 | 1287 |
| 🥈 2 | UQL | +218 | 1395 |
| 🥉 3 | TypeORM | +575 | 1752 |
| 4 | Drizzle | +600 | 1777 |
| 5 | Drizzle (bunSql) | +610 | 1698 |
| 6 | Sequelize | +906 | 2083 |
| 7 | Prisma | +965 | 2142 |
| 8 | MikroORM | +1723 | 2900 |
<!-- /bench:ranking -->

Rank is by `Adds`, not by total, so a lower total can sit further down when the two floors differ.

<!-- bench:headline -->
Totals only span 2.3x, because every entry pays the same database cost. What the ORM itself adds spans 9x: 199µs for UQL (bunSql), 1723µs for MikroORM.

Each entry is measured against its own driver's floor, so a faster driver is never counted as the ORM's win. Running the same UQL code on Bun SQL instead of `pg` saves 108µs, but only 19µs of that is UQL: the other 89µs is the gap between the two floors, free to anything on that driver.
<!-- /bench:headline -->

### Per step

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [TypeORM](https://typeorm.io) | [Drizzle](https://orm.drizzle.team) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 349 | 338 | **367** 🥇 | 371 | 480 | 517 | 520 | 465 | 920 | 450 |
| SELECT with WHERE, SORT, LIMIT 200 | 167 | 213 | **212** 🥇 | 261 | 350 | 286 | 247 | 413 | 288 | 798 |
| SELECT 50 parents with their children | 184 | 224 | **267** 🥇 | 316 | 379 | 459 | 419 | 582 | 400 | 948 |
| **Total**, all 7 steps | 1088 | 1177 | **1287** 🥇 | 1395 | 1752 | 1777 | 1698 | 2083 | 2142 | 2900 |
<!-- /bench:steps -->

<!-- bench:steps-note -->
The biggest gap is MikroORM's nested: 948µs against 267-582µs for everyone else. The other 4 steps are asserted every round but not published: they are round trips with almost nothing in them, worth 441-704µs of each total and separating the field by at most 122µs.
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

// UQL (bunSql), UQL
q.findMany(Company, {
  $select: { id: true, name: true },
  $populate: { users: { $select: { id: true, name: true } } },
  $where: { id: { $lte: NESTED_LIMIT } },
  $sort: { id: 1 },
})

// TypeORM
companies.find({
  select: { id: true, name: true, users: { id: true, name: true } },
  relations: { users: true },
  where: { id: LessThanOrEqual(NESTED_LIMIT) },
  order: { id: 'ASC' },
})

// Drizzle, Drizzle (bunSql)
db.query.Company.findMany({
  columns: { id: true, name: true },
  with: { users: { columns: { id: true, name: true } } },
  where: (t, { lte }) => lte(t.id, NESTED_LIMIT),
  orderBy: (t, { asc: a }) => a(t.id),
})

// Sequelize
SqCompany.findAll({
  attributes: ['id', 'name'],
  include: [{ model: SqUser, as: 'users', attributes: ['id', 'name'] }],
  where: { id: { [Op.lte]: NESTED_LIMIT } },
  order: [['id', 'ASC']],
})

// Prisma
db.company.findMany({
  select: { id: true, name: true, users: { select: { id: true, name: true } } },
  where: { id: { lte: NESTED_LIMIT } },
  orderBy: { id: 'asc' },
})

// MikroORM
fork().find(
  MikroCompanySchema,
  { id: { $lte: NESTED_LIMIT } },
  { fields: ['id', 'name', 'users.id', 'users.name'], populate: ['users'], orderBy: { id: 'ASC' } },
)
```
<!-- /bench:samples -->

</details>

## Type safety

What an ORM costs when you get a column name wrong. Ten ordinary mistakes, written in each ORM's own API in [type-safety/](type-safety/) and compiled to see whether the compiler objects.

<!-- bench:type-safety-env -->
> Checked with TypeScript 7.0.2, 10 probes per entry.
<!-- /bench:type-safety-env -->

<!-- bench:type-safety -->
| Mistake | [UQL](https://uql-orm.dev) | [Drizzle](https://orm.drizzle.team) | [MikroORM](https://mikro-orm.io) | [Prisma](https://www.prisma.io) | [TypeORM](https://typeorm.io) | [Sequelize](https://sequelize.org) |
| --- | --- | --- | --- | --- | --- | --- |
| Misspelled column in the projection | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Misspelled column in the filter | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| String value against a numeric column | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Text operator against a numeric column | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Misspelled column in the sort | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Misspelled column inside a loaded relation | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Misspelled column in inserted data | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Number written into a text column | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reading a column the projection left out | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reading a misspelled column off a loaded relation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Caught**, of 10 | **10** 🥇 | 9 | 9 | 9 | 9 | 5 |
<!-- /bench:type-safety -->

<!-- bench:type-safety-note -->
UQL catches 10 of the 10, Sequelize 5. Every mistake here is caught by at least one entry. The corrected copy of every file compiles clean, which is what makes a red mark a missing check rather than a broken query.
<!-- /bench:type-safety-note -->

Prisma's red mark on the first row is recent: TypeScript 6.0 stopped reporting excess properties on an object literal checked against a mapped type over an inferred type parameter, and 7 inherits it.

```ts
type Subset<T, U> = { [K in keyof T]: K extends keyof U ? T[K] : never };
declare function findMany<T extends Args>(args: Subset<T, Args>): T;
findMany({ select: { id: true, emial: true } }); // 5.9.3 errors; 6.0.3 and 7.0.2 are silent
```

That is how Prisma types a projection, so it loses a check it used to have. Counted as missing, not excused: a check the compiler no longer makes protects nobody. Drizzle's `db.query` types projections the same way and loses it too, which is why its flat probes are written on `db.select()`, the builder its timed read uses: a misspelling there is a property access, and the compiler still catches those.

MikroORM's filter probe names `createdAt`, since its `User` has no scalar `companyId` for one to name.

## Runtimes

Same lifecycle, three runtimes, one bundle built by Bun so the runtime is the only variable. All three measure the same seven entries. The `(bunSql)` rows sit out even on Bun: that client is a Bun API, and three extra entries per round would show up in the tail as if the runtime had caused it.

<!-- bench:runtime-env -->
> Bun 1.3.14, Node 24.20.0, Deno 2.9.6, all running the same bundled JavaScript, one at a time against the same database. PostgreSQL 18.6 (Homebrew), Apple M4 Max, September 2026. µs for a whole lifecycle, nearest-rank percentiles over 2000 rounds after 250 warmup, so a p99 is drawn from the 21 slowest rounds.
<!-- /bench:runtime-env -->

<!-- bench:runtimes -->
| Entry (µs) | Bun p50 | Bun p99 | Node p50 | Node p99 | Deno p50 | Deno p99 |
| --- | --- | --- | --- | --- | --- | --- |
| [raw pg](https://node-postgres.com) | 1207 | 3433 | **1195** | **1898** | 1260 | 4183 |
| [UQL](https://uql-orm.dev) | 1441 | 3896 | **1437** | **2565** | 1468 | 4699 |
| [TypeORM](https://typeorm.io) | 1770 | 5156 | 1755 | **3361** | **1732** | 6409 |
| [Drizzle](https://orm.drizzle.team) | 1876 | 5241 | **1714** | **2776** | 1784 | 5725 |
| [Sequelize](https://sequelize.org) | 2126 | 5731 | **2083** | **4189** | 2173 | 8080 |
| [Prisma](https://www.prisma.io) | **2138** | 5888 | 2219 | **4322** | 2456 | 8554 |
| [MikroORM](https://mikro-orm.io) | **2952** | 7996 | 3602 | **7570** | 3765 | 13333 |
<!-- /bench:runtimes -->

<!-- bench:runtime-note -->
On `raw pg`, the same code on all of them, the runtimes are 65µs apart at p50 but 2285µs apart at p99: Node leads both, and each p99 is 184% on Bun, 59% on Node, 232% on Deno above its own p50. Switching runtime moves any single entry by at most 813µs at p50 (MikroORM), where switching ORM on one runtime moves it 1448-2271µs, so the ORM is the bigger decision here. The one pair that changes places between runtimes is TypeORM and Drizzle, 35µs apart.
<!-- /bench:runtime-note -->

## Memory

How much heap each entry allocates to serve one lifecycle. Measured on Node, one process per entry: V8's counter is the only one of the three that moves on allocation rather than at a collection, and on Bun a hundred thousand fresh objects read as zero bytes. The `(bunSql)` rows sit out for the same reason the runtime table drops them.

<!-- bench:memory-env -->
> PostgreSQL 18.6 (Homebrew), Node 24.20.0, Apple M4 Max, September 2026. Median KB allocated per step over 60 rounds after 60 warmup of a 7-step lifecycle. Samples a garbage collection landed in are discarded, never corrected: at most 2% of them (MikroORM).
<!-- /bench:memory-env -->

<!-- bench:memory -->
| Entry | insert | read | nested | Total KB | Adds KB |
| --- | --- | --- | --- | --- | --- |
| _[raw pg](https://node-postgres.com)_ | 14 | 87 | 106 | 245 | floor |
| [UQL](https://uql-orm.dev) | 42 | 132 | 184 | 446 | **+201** 🥇 |
| [Drizzle](https://orm.drizzle.team) | 134 | 248 | 235 | 745 | +500 |
| [Prisma](https://www.prisma.io) | 273 | 220 | 373 | 1053 | +808 |
| [TypeORM](https://typeorm.io) | 126 | 295 | 503 | 1066 | +821 |
| [Sequelize](https://sequelize.org) | 100 | 425 | 585 | 1288 | +1043 |
| [MikroORM](https://mikro-orm.io) | 77 | 1470 | 2059 | 3864 | +3619 |
<!-- /bench:memory -->

<!-- bench:memory-note -->
Above the floor the field spans 18.0x: 201KB for UQL, 3619KB for MikroORM, and nested opens it widest: MikroORM's 2059KB against UQL's 184KB.

Almost none of it survives: another 60 lifecycles, collected either side, leave every heap smaller than it started, identity maps included. What the table prices is collector pressure, not a resident set that grows.
<!-- /bench:memory-note -->

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

Each rewrites the tables it owns, and none needs the others to have run.

## Method

- PostgreSQL runs natively, never in a container: a VM between client and server puts its latency into `Adds` instead of cancelling against the floor.
- All seven steps assert on the rows they return, every round, though only three are published: a step that quietly does nothing fails instead of winning. CI runs `--verify` on every push.
- Entries are interleaved and rotated, one pass each per round, because running each to completion made the results depend on declaration order. Warmup is half the run, capped at 250 rounds, and discarded.
- Medians per step, never means, so one GC pause cannot decide a number. Percentiles are of the round total, so a p99 is one slow lifecycle rather than seven unrelated slow operations.
- One connection each, no pooling, and each entry on its own idiomatic API: `createManyAndReturn` for Prisma, `insertMany` for UQL, `.returning()` for Drizzle, `em.find` for MikroORM. Only Prisma needs codegen, and it reaches Postgres through the `pg` adapter like the rest.
- Timed and scored through the same API, at `strict`, against the same entities and the same columns. Drizzle reaches its flat reads through `db.select()` and its nested read through `db.query`, in both halves, because those are the APIs its version offers for each job.
- Entity definitions are each ORM's current API, not a style we picked: MikroORM 7 ships no decorators and TypeORM's need a flag UQL's cannot share. Built once at startup, off the query path.
- The nested read is one statement for Sequelize, TypeORM and Drizzle, which join, and two for UQL, MikroORM and Prisma, which select the parents and then the children by `IN`. Postgres is local here, so the second round trip is cheap; over a network it would not be, and the split-query entries would lose ground.
- Deno gets an import map pinned to the installed versions, since it resolves npm itself: all three runtimes load the same libraries, not the same ranges.
- The memory benchmark inverts two of those: a process per entry, since a shared heap cannot be attributed, and no forced collection, since collecting frees compiled code and the rounds after it re-tier.

## What this does not measure

One connection, one machine, one schema, one database. Nothing here speaks to pooling or concurrency, HTTP and SSR, cold start, bundle size, transaction throughput, joins deeper than the nested read's single relation, or any database but PostgreSQL. Nor to migrations, tooling, ecosystem, or how pleasant any of it is to live with. The memory table is allocation per request, not resident set: what an idle process holds it does not measure.

An ORM that places last here can still be the right call on any of those.

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flows.ts`, wire them into `FLOWS`, and add it to `ENTRIES` in `scripts/model.ts`
4. Declare its client in `type-safety/clients.ts`, write the ten mistakes in `type-safety/<tool>.ts`, and name the file in `PROBE_FILES` in `scripts/probes.ts`
5. Run `bun run bench`, `bun run bench.memory` and `bun run bench.types`; the tables regenerate themselves

## License

[MIT](LICENSE.md)
