# TypeScript ORM benchmarks

What a TypeScript ORM costs you on one real PostgreSQL round trip, in time and in memory, and which mistakes it catches before you run it.

Every entry runs the same seven-step lifecycle over the same `Company`/`User` schema in its own idiomatic API, measured against hand-written `raw pg` and `bun sql` floors, so what you read is the ORM's cost and not Postgres'. Every tool is also [compiled against the same ordinary mistakes](#type-safety) and [renamed with its own tooling](#rename-safety), and the same lifecycle is [run on Bun and Node](#runtimes) and [weighed for what it allocates](#memory).

I wrote UQL, so read the tables rather than my summary of them. Clone it and check: that is what the [method](#method) is for.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

<!-- bench:env -->
> PostgreSQL 18.6 (Homebrew), Bun 1.4.2, Apple M4 Max, October 2026. Median µs per operation over 250 rounds, after 125 warmup rounds, interleaved and rotated. Every median is ±3.7% or tighter at 95% confidence.
<!-- /bench:env -->

<!-- bench:versions -->
_Versions: [Drizzle](https://orm.drizzle.team) 0.45.4 · [MikroORM](https://mikro-orm.io) 7.2.5 · [Prisma](https://www.prisma.io) 7.10.0 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.2 · [UQL](https://uql-orm.dev) 0.100.3._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1095 |
| ref | _raw pg_ | floor | 1114 |
| 1 | **UQL (bunSql)** | +261 | 1356 |
| 1 | **UQL** | +308 | 1422 |
| 1 | **Drizzle (bunSql)** | +352 | 1447 |
| 2 | Drizzle | +384 | 1498 |
| 4 | TypeORM | +492 | 1606 |
| 6 | Sequelize | +825 | 1939 |
| 7 | Prisma | +957 | 2071 |
| 8 | MikroORM | +1503 | 2617 |
<!-- /bench:ranking -->

Places are by `Adds`, not by total, so a lower total can sit further down when the two floors differ. Entries share a place when their confidence intervals overlap: an equal number is a difference this run cannot resolve, not a tie broken in someone's favour.

<!-- bench:headline -->
Totals only span 1.9x, because every entry pays the same database cost. What the ORM itself adds spans 6x: 261µs for UQL (bunSql), 1503µs for MikroORM.

Each entry is measured against its own driver's floor, so a faster driver is never counted as the ORM's win. Running the same UQL code on Bun SQL instead of `pg` saves 66µs, but only 47µs of that is UQL: the other 19µs is the gap between the two floors, free to anything on that driver.
<!-- /bench:headline -->

### Per step

<!-- bench:steps -->
| Entry (µs) | insert | read | nested | Total, 7 steps |
| --- | --- | --- | --- | --- |
| _[bun sql](https://bun.sh/docs/api/sql)_ | 333 | 172 | 190 | 1095 |
| _[raw pg](https://node-postgres.com)_ | 316 | 195 | 205 | 1114 |
| [UQL (bunSql)](https://uql-orm.dev) | **354** | **214** | **308** | **1356** |
| [UQL](https://uql-orm.dev) | 369 | 247 | 330 | 1422 |
| [Drizzle (bunSql)](https://orm.drizzle.team) | 396 | 233 | 343 | 1447 |
| [Drizzle](https://orm.drizzle.team) | 402 | 247 | 375 | 1498 |
| [TypeORM](https://typeorm.io) | 442 | 308 | 319 | 1606 |
| [Sequelize](https://sequelize.org) | 445 | 367 | 494 | 1939 |
| [Prisma](https://www.prisma.io) | 865 | 270 | 386 | 2071 |
| [MikroORM](https://mikro-orm.io) | 421 | 697 | 867 | 2617 |
<!-- /bench:steps -->

<!-- bench:steps-note -->
Columns: insert is INSERT 10 rows, returning ids; read is SELECT with WHERE, SORT, LIMIT 200; nested is SELECT 50 parents with their children. The biggest gap is MikroORM's nested: 867µs against 308-494µs for everyone else. The other 4 steps are asserted every round but not published: they are round trips with almost nothing in them, worth 474-633µs of each total and separating the field by at most 95µs.
<!-- /bench:steps-note -->

### The nested read, as each entry writes it

Lifted out of [scripts/flows.ts](scripts/flows.ts) at generation time, so what is shown is what ran; the other six steps are in that file.

<details>
<summary>50 parents with their children, in each entry's own API</summary>

<!-- bench:samples -->
```ts
// bun sql
{
  const rows: FlatRow[] = await sql`
    SELECT c.id AS "cId", c.name AS "cName", u.id AS "uId", u.name AS "uName"
    FROM "Company" c LEFT JOIN "User" u ON u."companyId" = c.id
    WHERE c.id <= ${NESTED_LIMIT} ORDER BY c.id
  `;
  return nestFlatRows(rows);
}

// raw pg
nestFlatRows(
  (
    await db.query<FlatRow>(
      `SELECT c.id "cId", c.name "cName", u.id "uId", u.name "uName"
       FROM "${COMPANY_TABLE}" c LEFT JOIN "${USER_TABLE}" u ON u."companyId" = c.id
       WHERE c.id <= $1 ORDER BY c.id`,
      [NESTED_LIMIT],
    )
  ).rows,
)

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
> Checked with TypeScript 7.0.2, 12 probes per entry.
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
| Required column left out of inserted data | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Number written into a text column | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reading a column the projection left out | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Reading a misspelled column off a loaded relation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Caught**, of 12 | 10 | 10 | 11 | 6 | 10 | **12** |
<!-- /bench:type-safety -->

<!-- bench:type-safety-note -->
UQL catches 12 of the 12, Sequelize 6. Every mistake here is caught by at least one entry. The corrected copy of every file compiles clean, which is what makes a red mark a missing check rather than a broken query.
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
> Renamed `emailAddress` to `email`, `employerId` to `workplaceId` and `employer` to `workplace`, with TypeScript 7.0.2 and prisma-language-server 31.12.15.
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

Same lifecycle, two runtimes, one bundle built by Bun so the runtime is the only variable. Both measure the same entries. The `(bunSql)` rows sit out even on Bun: that client is a Bun API, and three extra entries per round would show up in the tail as if the runtime had caused it.

<!-- bench:runtime-env -->
> Bun 1.4.2, Node 24.20.0, all running the same bundled JavaScript, one at a time against the same database. PostgreSQL 18.6 (Homebrew), Apple M4 Max, October 2026. µs for a whole lifecycle, nearest-rank percentiles over 2000 rounds after 250 warmup, so a p99 is drawn from the 21 slowest rounds.
<!-- /bench:runtime-env -->

<!-- bench:runtimes -->
| Entry (µs) | Bun p50 | Bun p99 | Node p50 | Node p99 |
| --- | --- | --- | --- | --- |
| [raw pg](https://node-postgres.com) | **1131** | **3580** | 1225 | 4120 |
| [UQL](https://uql-orm.dev) | **1435** | **4624** | 1584 | 5901 |
| [Drizzle](https://orm.drizzle.team) | **1527** | **5017** | 1786 | 6436 |
| [TypeORM](https://typeorm.io) | **1576** | **5695** | 1837 | 7508 |
| [Sequelize](https://sequelize.org) | **1871** | **6795** | 2202 | 8640 |
| [Prisma](https://www.prisma.io) | **1964** | **6610** | 2356 | 9084 |
| [MikroORM](https://mikro-orm.io) | **2635** | **10324** | 3834 | 14603 |
<!-- /bench:runtimes -->

<!-- bench:runtime-note -->
On `raw pg`, where the code is identical, the runtimes are 94µs apart at p50 but 540µs apart at p99: Bun leads both, and each p99 is 217% on Bun, 236% on Node above its own p50. Switching runtime moves any single entry by at most 1199µs at p50 (MikroORM), where switching ORM on one runtime moves it 1149-2216µs. Both are differences of measured medians, known to ±45µs and ±39µs, so read them as ranges rather than as a ranking. Ranked by what each ORM adds, every runtime agrees: UQL < Drizzle < TypeORM < Sequelize < Prisma < MikroORM.
<!-- /bench:runtime-note -->

## Memory

How much heap each entry allocates to serve one lifecycle. Measured on Node, one process per entry: V8's counter moves on allocation rather than at a collection, where on Bun a hundred thousand fresh objects read as zero bytes. The `(bunSql)` rows sit out for the same reason the runtime table drops them.

<!-- bench:memory-env -->
> PostgreSQL 18.6 (Homebrew), Node 24.20.0, Apple M4 Max, October 2026. Median KB allocated per step over 60 rounds after 60 warmup of a 7-step lifecycle. Rounds a garbage collection ran in are discarded, never corrected, and no entry lost more than 1% of its own (MikroORM).
<!-- /bench:memory-env -->

<!-- bench:memory -->
| Entry | insert | read | nested | Total KB | Adds KB |
| --- | --- | --- | --- | --- | --- |
| _[raw pg](https://node-postgres.com)_ | 14 | 87 | 105 | 240 | floor |
| [UQL](https://uql-orm.dev) | 52 | 110 | 87 | 355 | **+115** |
| [Drizzle](https://orm.drizzle.team) | 141 | 251 | 243 | 763 | +523 |
| [TypeORM](https://typeorm.io) | 126 | 295 | 503 | 1066 | +826 |
| [Prisma](https://www.prisma.io) | 274 | 221 | 374 | 1076 | +836 |
| [Sequelize](https://sequelize.org) | 100 | 425 | 585 | 1306 | +1066 |
| [MikroORM](https://mikro-orm.io) | 83 | 1477 | 2089 | 3917 | +3677 |
<!-- /bench:memory -->

<!-- bench:memory-note -->
Above the floor the field spans 32.0x: 115KB for UQL, 3677KB for MikroORM, and nested opens it widest: MikroORM's 2089KB against UQL's 87KB.

Almost none of it survives: another 60 lifecycles, collected either side, leave every heap smaller than it started, identity maps included. What the table prices is collector pressure, not a resident set that grows.
<!-- /bench:memory-note -->

## Method

- PostgreSQL runs natively, never in a container: a VM between client and server puts its latency into `Adds` instead of cancelling against the floor.
- One connection each, no pooling, and each entry on its own idiomatic API: `.returning()` for Drizzle, `em.find` for MikroORM, `createManyAndReturn` for Prisma, `insertMany` for UQL. A single row is read through each tool's own call for one (`findOneById`, `findUnique`, `findOne`, `findByPk`), and an update or delete by id reports how many rows it reached, with no `RETURNING`: Prisma's `update` and `delete` always return the row, so it alone sends one. MikroORM gets a fresh `em.fork()` per operation, as its [identity-map docs](https://mikro-orm.io/docs/identity-map) call for, so no Unit-of-Work state piles up across the run. Its insert is the one step on `createQueryBuilder`: `em.insertMany` emits the same single `INSERT ... RETURNING "id"` but returns only the first id, so the step could not assert all ten rows through it. Only Prisma needs codegen, and it reaches Postgres through the `pg` adapter like the rest.
- Entity definitions are each ORM's current API: MikroORM 7 keeps its decorators in a separate package this does not install, and TypeORM's need `experimentalDecorators`, which UQL's standard decorators cannot share. Built once at startup, off the query path.
- Timed and scored through the same API, at `strict`, against the same entities and the same columns. Drizzle reaches its flat reads through `db.select()` and its nested read through `db.query`, in both halves, because those are the APIs its version offers for each job.
- The nested read is one statement for Drizzle, Sequelize, TypeORM and UQL, and two for MikroORM and Prisma, which select the parents and then the children by `IN`. Postgres is local here, so the second round trip is cheap; over a network it would not be, and the split-query entries would lose ground. UQL has Postgres build the children as JSON, so its client reads 50 rows where the floor's join reads 200.
- Entries are interleaved and rotated, one pass each per round, so no entry keeps a favourable position. Warmup is half the run, capped at 250 rounds, and discarded.
- All seven steps assert on the rows they return, every round, though only three are published: a step that quietly does nothing fails instead of winning. CI runs `--verify` on every push.
- Medians per step, never means, so one GC pause cannot decide a number. Percentiles are of the round total, so a p99 is one slow lifecycle rather than seven unrelated slow operations.
- The memory benchmark inverts two of those: a process per entry, since a shared heap cannot be attributed, and no forced collection, since collecting frees compiled code and the rounds after it re-tier.

## What this does not measure

One connection, one machine, one schema, one database. Nothing here speaks to pooling or concurrency, HTTP and SSR, cold start, bundle size, transaction throughput, joins deeper than the nested read's single relation, or any database but PostgreSQL. Nor to migrations, tooling, ecosystem, or how pleasant any of it is to live with. The memory table is allocation per request, not resident set: what an idle process holds it does not measure.

An ORM that places last here can still be the right call on any of those.

## Run it

You need [Bun](https://bun.sh) and a PostgreSQL you can reach. The runtime table also needs Node installed.

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

export DATABASE_URL=postgres://localhost:5432/postgres
bun run bench
bun run bench.runtimes
bun run bench.memory
bun run bench.types
bun run bench.renames
```

Each rewrites the tables it owns, and none needs the others to have run. Every block they write also lands in `report.json`, for anyone rendering these numbers elsewhere. Run them on an idle machine that cannot sleep, from a terminal in front, so nothing else shares the CPU: `caffeinate -dimsu bun run bench` on macOS.

| Flag | Takes it | Does |
| --- | --- | --- |
| `--iterations <n>` | every benchmark | Measured rounds. Fewer than the default holds the medians, not the p99 |
| `--verify` | every benchmark | Asserts every step or probe and writes nothing; what CI runs |
| `--json <path>` | `bench`, `bench.memory` | Writes the run there and leaves the README alone |
| `--portable` | `bench` | Only the entries every runtime can load |

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flows.ts`, wire them into `FLOWS`, and add it to `ENTRIES` and `TOOLS` in `scripts/model.ts`. `TOOLS` is where its link, version and probe file name come from
4. Declare its client in `type-safety/clients.ts` and write the probes of `scripts/probes.ts` in `type-safety/<probe>.ts`, and its model and the mentions of `scripts/renames.ts` in `rename-safety/<probe>.ts`
5. Run `bun run bench`, `bun run bench.runtimes`, `bun run bench.memory`, `bun run bench.types` and `bun run bench.renames`; the tables regenerate themselves

## License

[MIT](LICENSE.md)
