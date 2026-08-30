# ⚡ TypeScript ORM Benchmark

What a TypeScript ORM costs you on one real PostgreSQL round trip, and which mistakes it catches before you run it.

Every entry runs the same seven-step lifecycle against the same schema, in its own idiomatic API: insert, read, update, read, nested read, delete, read. `raw pg` and `bun sql` are hand-written SQL with the rows mapped by hand, so what you read is the ORM's cost and not Postgres'. The same lifecycle runs on [Bun, Node and Deno](#runtimes), and the same six ORMs are [compiled against ten ordinary mistakes](#type-safety).

I wrote UQL, so read the tables rather than my summary of them. Clone it and check: that is what the [method](#method) is for.

**[Interactive charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊 · **[Write-up](https://uql-orm.dev/blog/what-orms-really-cost)**

## Results

<!-- bench:env -->
> PostgreSQL 18.6 (Homebrew), Bun 1.3.14, Apple M4 Pro, August 2026. Median µs per operation over 250 rounds, after 125 warmup rounds, interleaved and rotated. Every median is ±2.8% or tighter at 95% confidence (widest: UQL (bunSql)).
<!-- /bench:env -->

<!-- bench:versions -->
_Versions: [UQL](https://uql-orm.dev) 0.33.0 · [Prisma](https://www.prisma.io) 7.10.0 · [Sequelize](https://sequelize.org) 6.37.8 · [TypeORM](https://typeorm.io) 1.1.0 · [MikroORM](https://mikro-orm.io) 7.1.14 · [Drizzle](https://orm.drizzle.team) 0.45.2._
<!-- /bench:versions -->

<!-- bench:ranking -->
| # | Entry | Adds µs | Total µs |
| --- | --- | --- | --- |
| ref | _bun sql_ | floor | 1204 |
| ref | _raw pg_ | floor | 1273 |
| 🥇 1 | **UQL (bunSql)** | +207 | 1411 |
| 🥈 2 | UQL | +258 | 1531 |
| 🥉 3 | Drizzle (bunSql) | +626 | 1830 |
| 4 | TypeORM | +662 | 1935 |
| 5 | Drizzle | +697 | 1970 |
| 6 | Sequelize | +1059 | 2332 |
| 7 | Prisma | +1094 | 2367 |
| 8 | MikroORM | +1968 | 3241 |
<!-- /bench:ranking -->

Rank is by `Adds`, not by total, so a lower total can sit further down when the two floors differ.

<!-- bench:headline -->
Totals only span 2.3x, because every entry pays the same database cost. What the ORM itself adds spans 10x: 207µs for UQL (bunSql), 1968µs for MikroORM.

Each entry is measured against its own driver's floor, so a faster driver is never counted as the ORM's win. Running the same UQL code on Bun SQL instead of `pg` saves 120µs, but only 51µs of that is UQL: the other 69µs is the gap between the two floors, free to anything on that driver.
<!-- /bench:headline -->

### Per step

The three steps where the amount of data bound and hydrated decides the number.

<!-- bench:steps -->
| Operation (µs) | [bun sql](https://bun.sh/docs/api/sql) | [raw pg](https://node-postgres.com) | [UQL (bunSql)](https://uql-orm.dev) | [UQL](https://uql-orm.dev) | [Drizzle (bunSql)](https://orm.drizzle.team) | [TypeORM](https://typeorm.io) | [Drizzle](https://orm.drizzle.team) | [Sequelize](https://sequelize.org) | [Prisma](https://www.prisma.io) | [MikroORM](https://mikro-orm.io) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT 10 rows, returning ids | 423 | 400 | **445** 🥇 | 452 | 596 | 578 | 621 | 570 | 1070 | 541 |
| SELECT with WHERE, SORT, LIMIT 200 | 183 | 230 | **233** 🥇 | 287 | 267 | 388 | 313 | 456 | 316 | 894 |
| SELECT 50 parents with their children | 196 | 234 | **275** 🥇 | 325 | 442 | 399 | 499 | 626 | 420 | 995 |
| **Total**, all 7 steps | 1204 | 1273 | **1411** 🥇 | 1531 | 1830 | 1935 | 1970 | 2332 | 2367 | 3241 |
<!-- /bench:steps -->

<!-- bench:steps-note -->
The biggest gap is Prisma's insert: 1070µs against 445-621µs for everyone else. The other 4 steps are asserted every round but not published: they are round trips with almost nothing in them, worth 458-811µs of each total and separating the field by at most 147µs.
<!-- /bench:steps-note -->

### The queries behind those numbers

Lifted out of [scripts/flows.ts](scripts/flows.ts) at generation time, so what is shown is what ran. Entries sharing a snippet share the code: `UQL (bunSql)` is UQL on a second driver, not a second way of writing the query.

<details>
<summary>The three published steps, in all nine</summary>

<!-- bench:samples -->
**INSERT 10 rows, returning ids**

```ts
// bun sql
sql`INSERT INTO "User" ${sql(NEW_USERS)} RETURNING id`

// raw pg
(await db.query(insertSql, insertParams)).rows

// UQL (bunSql), UQL
q.insertMany(User, NEW_USERS)

// Drizzle (bunSql), Drizzle
db.insert(drizzleUsers).values(NEW_USERS).returning({ id: drizzleUsers.id })

// TypeORM
repo.insert(NEW_USERS)

// Sequelize
SqUser.bulkCreate(NEW_USERS)

// Prisma
db.user.createManyAndReturn({ data: NEW_USERS, select: { id: true } })

// MikroORM
fork().createQueryBuilder(MikroUserSchema).insert(mikroNew).execute()
```

**SELECT with WHERE, SORT, LIMIT 200**

```ts
// bun sql
sql`SELECT id,name,email,"companyId","createdAt" FROM "User" WHERE "companyId" > 0 ORDER BY id LIMIT ${READ_LIMIT}`

// raw pg
(
  await db.query(
    `SELECT id,name,email,"companyId","createdAt" FROM "${USER_TABLE}" WHERE "companyId" > $1 ORDER BY id LIMIT $2`,
    [0, READ_LIMIT],
  )
).rows

// UQL (bunSql), UQL
q.findMany(User, {
  $select: { id: true, name: true, email: true, companyId: true, createdAt: true },
  $where: { companyId: { $gt: 0 } },
  $sort: { id: 1 },
  $limit: READ_LIMIT,
})

// Drizzle (bunSql), Drizzle
db
  .select({
    id: drizzleUsers.id,
    name: drizzleUsers.name,
    email: drizzleUsers.email,
    companyId: drizzleUsers.companyId,
    createdAt: drizzleUsers.createdAt,
  })
  .from(drizzleUsers)
  .where(gt(drizzleUsers.companyId, 0))
  .orderBy(asc(drizzleUsers.id))
  .limit(READ_LIMIT)

// TypeORM
repo.find({
  select: { id: true, name: true, email: true, companyId: true, createdAt: true },
  where: { companyId: MoreThan(0) },
  order: { id: 'ASC' },
  take: READ_LIMIT,
})

// Sequelize
SqUser.findAll({
  attributes: ['id', 'name', 'email', 'companyId', 'createdAt'],
  where: { companyId: { [Op.gt]: 0 } },
  order: [['id', 'ASC']],
  limit: READ_LIMIT,
})

// Prisma
db.user.findMany({
  select: { id: true, name: true, email: true, companyId: true, createdAt: true },
  where: { companyId: { gt: 0 } },
  orderBy: { id: 'asc' },
  take: READ_LIMIT,
})

// MikroORM
fork().find(
  MikroUserSchema,
  { company: { $gt: 0 } },
  { fields: ['id', 'name', 'email', 'company', 'createdAt'], orderBy: { id: 'ASC' }, limit: READ_LIMIT },
)
```

**SELECT 50 parents with their children**

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

// Drizzle (bunSql), Drizzle
db.query.Company.findMany({
  columns: { id: true, name: true },
  with: { users: { columns: { id: true, name: true } } },
  where: (t, { lte }) => lte(t.id, NESTED_LIMIT),
  orderBy: (t, { asc: a }) => a(t.id),
})

// TypeORM
companies.find({
  select: { id: true, name: true, users: { id: true, name: true } },
  relations: { users: true },
  where: { id: LessThanOrEqual(NESTED_LIMIT) },
  order: { id: 'ASC' },
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

Speed is what an ORM costs at runtime. This is what it costs when you get a column name wrong: ten ordinary mistakes, each written in every ORM's own API in [type-safety/](type-safety/), each compiled to see whether the compiler objects.

<!-- bench:type-safety-env -->
> Checked with TypeScript 7.0.2, 10 probes per entry.
<!-- /bench:type-safety-env -->

<!-- bench:type-safety -->
| Mistake | [UQL](https://uql-orm.dev) | [MikroORM](https://mikro-orm.io) | [Prisma](https://www.prisma.io) | [TypeORM](https://typeorm.io) | [Drizzle](https://orm.drizzle.team) | [Sequelize](https://sequelize.org) |
| --- | --- | --- | --- | --- | --- | --- |
| Misspelled column in the projection | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Misspelled column in the filter | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| String value against a numeric column | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Text operator against a numeric column | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Misspelled column in the sort | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Misspelled column inside a loaded relation | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Misspelled column in inserted data | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Number written into a text column | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reading a column the projection left out | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Reading a misspelled column off a loaded relation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Caught**, of 10 | **10** 🥇 | 9 | 9 | 9 | 8 | 5 |
<!-- /bench:type-safety -->

<!-- bench:type-safety-note -->
UQL catches 10 of the 10, Sequelize 5. Every mistake here is caught by at least one entry. The corrected copy of every file compiles clean, which is what makes a red mark a missing check rather than a broken query.
<!-- /bench:type-safety-note -->

Prisma's and Drizzle's red mark on the first row is recent. TypeScript 6.0 stopped reporting excess properties on an object literal checked against a mapped type over an inferred type parameter, and 7 inherits it:

```ts
type Subset<T, U> = { [K in keyof T]: K extends keyof U ? T[K] : never };
declare function findMany<T extends Args>(args: Subset<T, Args>): T;
findMany({ select: { id: true, emial: true } }); // 5.9.3 errors; 6.0.3 and 7.0.2 are silent
```

That is how both type a projection, so both lose a check they used to have. Counted as missing, not excused: a check the compiler no longer makes protects nobody. The two floors have no row at all, being SQL strings.

## Runtimes

Same lifecycle, three runtimes, one bundle built by Bun so the runtime is the only variable. All three measure the same seven entries. The `(bunSql)` rows sit out even on Bun: that client is a Bun API, and three extra entries per round would show up in the tail as if the runtime had caused it.

<!-- bench:runtime-env -->
> Bun 1.3.14, Node 24.18.1, Deno 2.9.5, all running the same bundled JavaScript, one at a time against the same database. PostgreSQL 18.6 (Homebrew), Apple M4 Pro, August 2026. µs for a whole lifecycle, nearest-rank percentiles over 2000 rounds after 250 warmup, so a p99 is drawn from the 21 slowest rounds.
<!-- /bench:runtime-env -->

<!-- bench:runtimes -->
| Entry (µs) | Bun p50 | Bun p99 | Node p50 | Node p99 | Deno p50 | Deno p99 |
| --- | --- | --- | --- | --- | --- | --- |
| [raw pg](https://node-postgres.com) | **1284** | 2975 | 1293 | 2988 | 1361 | **2185** |
| [UQL](https://uql-orm.dev) | **1516** | 3481 | 1533 | 3655 | 1564 | **2824** |
| [TypeORM](https://typeorm.io) | 1914 | 4202 | **1870** | 4480 | 1871 | **3980** |
| [Drizzle](https://orm.drizzle.team) | 1959 | 4531 | **1834** | 4160 | 1916 | **3446** |
| [Sequelize](https://sequelize.org) | 2281 | 5546 | **2261** | 5840 | 2344 | **4632** |
| [Prisma](https://www.prisma.io) | **2275** | 5433 | 2405 | **5188** | 2652 | 5198 |
| [MikroORM](https://mikro-orm.io) | **3158** | **8110** | 3935 | 9870 | 3975 | 8531 |
<!-- /bench:runtimes -->

<!-- bench:runtime-note -->
On `raw pg`, the same code on all of them, the runtimes are 77µs apart at p50 but 803µs apart at p99: Bun leads the median, Deno the tail, and each p99 is 132% on Bun, 131% on Node, 61% on Deno above its own p50. Switching runtime moves any single entry by at most 817µs at p50 (MikroORM), where switching ORM on one runtime moves it 1575-2354µs, so the ORM is the bigger decision here. The one pair that changes places between runtimes is TypeORM and Drizzle, 26µs apart.
<!-- /bench:runtime-note -->

## Run it

You need [Bun](https://bun.sh) and a PostgreSQL you can reach. Node and Deno only need to be installed; whichever are found get a column.

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

DATABASE_URL=postgres://localhost:5432/postgres bun run bench
DATABASE_URL=postgres://localhost:5432/postgres bun run bench.runtimes
bun run bench.types
```

Each rewrites the tables it owns, and none needs the others to have run.

## Method

- All seven steps assert on the rows they return, every round, though only three are published: a step that quietly does nothing fails instead of winning. CI runs `--verify` on every push.
- Entries are interleaved and rotated, one pass each per round, because running each to completion made the results depend on declaration order. Warmup is half the run, capped at 250 rounds, and discarded.
- Medians per step, never means, so one GC pause cannot decide a number. Percentiles are of the round total, so a p99 is one slow lifecycle rather than seven unrelated slow operations.
- One connection each, no pooling, and each entry on its own idiomatic API: `createManyAndReturn` for Prisma, `insertMany` for UQL, `.returning()` for Drizzle, `em.find` for MikroORM. Only Prisma needs codegen, and it reaches Postgres through the `pg` adapter like the rest.
- Timed and scored through the same API, at `strict`, against the same entities and the same columns. Drizzle is the one exception, timed on `db.select()` and scored on `db.query`, since only the latter puts a projection, a filter and a sort in one object; at 419µs against 485µs the split favours Drizzle, so it stays.
- Entity definitions are each ORM's current API, not a style we picked: MikroORM 7 ships no decorators and TypeORM's need a flag UQL's cannot share. Built once at startup, off the query path.
- Deno resolves npm itself, so it gets an import map pinned to the installed versions. All three runtimes load the same libraries, not the same ranges.

## What this does not measure

One connection, one machine, one schema, one database. Nothing here speaks to pooling or concurrency, HTTP and SSR, memory, cold start, bundle size, transaction throughput, joins deeper than the nested read's single relation, or any database but PostgreSQL. Nor to migrations, tooling, ecosystem, or how pleasant any of it is to live with.

An ORM that places last here can still be the right call on any of those.

## Adding an ORM

1. Add it as a `devDependency`
2. Give it the same `Company` and `User` shape in `src/schema.ts`, and a client in `src/clients.ts`
3. Write its seven steps in `scripts/flows.ts`, wire them into `FLOWS`, and add it to `ENTRIES` in `scripts/model.ts`
4. Declare its client in `type-safety/clients.ts`, write the ten mistakes in `type-safety/<tool>.ts`, and name the file in `PROBE_FILES` in `scripts/probes.ts`
5. Run `bun run bench` and `bun run bench.types`; the tables regenerate themselves

## License

[MIT](LICENSE.md)
