# ⚡ ts-orm-benchmark

Independent benchmark comparing TypeScript **ORMs** and **query builders** on two things that both cost you time on every request:

1. **SQL generation**: building the statement and its parameters, with no database involved.
2. **Database round trip**: a full insert/read/update/read/nested-read/delete/read lifecycle against PostgreSQL, including decoding rows back into objects and assembling relations.

The second is the one most benchmarks skip, and it is where an ORM's row hydration shows up. Both are reported, because they answer different questions: generation tells you the floor, the round trip tells you what you actually pay.

**[Benchmark Charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊

## SQL generation

> Node.js v24.18.1, Apple Silicon M-series, August 2026. **K ops/sec, higher is better**, 3 runs averaged.

<!-- bench:generation -->
| Operation | [UQL](https://uql-orm.dev) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [MikroORM](https://mikro-orm.io) | [Drizzle](https://orm.drizzle.team) | [Knex](https://knexjs.org) | [Kysely](https://kysely.dev) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INSERT (10 rows) | **692K** 🥇 | 202K | 43K | 79K | 12K | 458K | 192K |
| UPDATE (SET+WHERE) | **2,160K** 🥇 | 236K | 279K | 222K | 79K | 707K | 810K |
| UPSERT (ON CONFLICT) | **698K** 🥇 | 333K | 237K | 222K | 36K | 442K | 335K |
| DELETE (WHERE) | **3,796K** 🥇 | 1,306K | 503K | 260K | 208K | 1,102K | 1,266K |
| SELECT (1 field) | **4,338K** 🥇 | 3,136K | 575K | 560K | 218K | 1,116K | 1,528K |
| SELECT (WHERE+SORT+LIMIT) | **1,353K** 🥇 | 389K | 275K | 72K | 59K | 611K | 424K |
| SELECT (complex $or) | **721K** 🥇 | 152K | 156K | 27K | 35K | 240K | 211K |
| SELECT (populate JOIN) | **703K** 🥇 | n/a | 199K | 102K | 58K | 373K | 284K |
| AGGREGATE (GROUP+HAVING) | **1,465K** 🥇 | 413K | 276K | 68K | 73K | 306K | 213K |
| **Total** | **15,926K** 🥇 | n/a | 2,543K | 1,612K | 778K | 5,355K | 5,263K |
<!-- /bench:generation -->

**UQL wins 9 out of 9**, even against standalone query builders (Knex, Kysely) that have zero entity/relation overhead.

<!-- bench:generation-ranking -->
| P | Entry | Wins | Total K ops/sec | Widest lead |
| --- | --- | --- | --- | --- |
| 🥇 1 | **UQL** | **9/9** 🏆 | 15,926K | 57.7x |
| 🥈 2 | Knex | 0/9 | 5,355K | 38.2x |
| 🥉 3 | Kysely | 0/9 | 5,263K | 16.0x |
| 4 | TypeORM | 0/9 | 2,543K | 6.6x |
| 5 | MikroORM | 0/9 | 1,612K | 6.6x |
| 6 | Drizzle | 0/9 | 778K | 1.3x |
| 7 | Sequelize | 0/9 | n/a | 16.8x |
<!-- /bench:generation-ranking -->

## Database round trip

> PostgreSQL 18.4, same machine. **µs per operation, lower is better**, median of 250 interleaved iterations.
>
> `raw pg` and `bun sql` are hand-written driver code with manual row mapping. They are reference floors rather than competitors, so they are listed but excluded from the win counts. The `(bunSql)` rows swap the driver, not the query builder, and only UQL and Drizzle ship a Bun SQL adapter.

<!-- bench:flow -->
| Operation | [raw pg](https://node-postgres.com) | [bun sql](https://bun.sh/docs/api/sql) | [UQL](https://uql-orm.dev) | [UQL (bunSql)](https://uql-orm.dev) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [MikroORM](https://mikro-orm.io) | [Drizzle](https://orm.drizzle.team) | [Drizzle (bunSql)](https://orm.drizzle.team) | [Knex](https://knexjs.org) | [Kysely](https://kysely.dev) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| insert | 392 | 415 | 434 | **429** 🥇 | 551 | 555 | 527 | 573 | 568 | 464 | 453 |
| read | 238 | 184 | 291 | **225** 🥇 | 460 | 390 | 801 | 313 | 268 | 282 | 282 |
| update | 135 | 135 | 151 | **150** 🥇 | 296 | 194 | 258 | 176 | 172 | 168 | 163 |
| readAgain | 77 | 72 | 92 | **89** 🥇 | 121 | 119 | 121 | 107 | 106 | 96 | 92 |
| nested | 228 | 187 | 336 | 277 | 625 | 458 | 1152 | 490 | 425 | 274 | **271** 🥇 |
| delete | 124 | 125 | 217 | 215 | 154 | 154 | 212 | 145 | 146 | **141** 🥇 | **141** 🥇 |
| readEmpty | 72 | 68 | 81 | **68** 🥇 | 105 | 107 | 103 | 101 | 98 | 90 | 86 |
| **Total** | 1266 | 1186 | 1602 | **1453** 🥇 | 2312 | 1977 | 3174 | 1905 | 1783 | 1515 | 1488 |
<!-- /bench:flow -->

<!-- bench:flow-ranking -->
| P | Entry | Wins | Total µs/op | Widest lead |
| --- | --- | --- | --- | --- |
| ref | _bun sql_ | ref | 1186 | 6.2x |
| ref | _raw pg_ | ref | 1266 | 5.1x |
| 🥇 1 | **UQL (bunSql)** | **5/7** 🏆 | 1453 | 4.2x |
| 🥈 2 | **Kysely** | **1/7** 🏆 | 1488 | 4.3x |
| 🥉 3 | **Knex** | **1/7** 🏆 | 1515 | 4.2x |
| 4 | UQL | 0/7 | 1602 | 3.4x |
| 5 | Drizzle (bunSql) | 0/7 | 1783 | 3.0x |
| 6 | Drizzle | 0/7 | 1905 | 2.6x |
| 7 | TypeORM | 0/7 | 1977 | 2.5x |
| 8 | Sequelize | 0/7 | 2312 | 1.8x |
| 9 | MikroORM | 0/7 | 3174 | 1.1x |
<!-- /bench:flow-ranking -->

Every step verifies the one before it: `readAgain` asserts the update landed, `readEmpty` asserts the delete did. A step that silently does nothing fails the run instead of scoring well.

Three things worth reading out of this, including the parts that are not flattering:

- **The spread narrows sharply once a database is involved.** Generation differs by up to 57x; the full lifecycle differs by about 2.2x from fastest to slowest. Statement building is real overhead, but it is not what dominates a request. Anyone quoting only a generation benchmark is quoting the smaller number.
- **UQL's weakest step is `delete`** (217µs against 141µs for Knex and Kysely). `deleteMany` walks the relation graph in JS: a `SELECT` for the ids, a delete per cascade level, then the parent. Declaring `onDelete: 'CASCADE'` on the relation, added in UQL 0.25.0, hands that to the database as a single statement instead. The measurement above does not use it, so this is the unoptimised path.
- **The driver is worth roughly as much as the query builder.** The same UQL code over Bun's SQL is 149µs faster per lifecycle than over `pg`, which is a larger gap than the one between UQL and Kysely.

### Why No Prisma?

- **Prisma**: Even in v7 ("Rust-free"), the Query Compiler that generates SQL is still **Rust compiled to WebAssembly**, not pure JS/TS. Additionally, Prisma exposes no public `.toSQL()` or `.compile()` API, making it untestable in the generation benchmark.

## Quick Start

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install

npm run bench                                  # SQL generation, no database needed
DATABASE_URL=postgres:///postgres npm run bench.flow   # round trip, creates its own database
```

Both write into `results.js` and this README, and each keeps the other's numbers, so either can be re-run on its own.

## What's Measured

### Generation

Each ORM generates equivalent SQL from the same logical query definition. No network, no database, no connection pooling: this isolates the ORM overhead that runs on every request.

9 query types:

1. **Batch INSERT**: 10 rows in a single statement
2. **UPDATE**: SET 2 fields with WHERE clause
3. **UPSERT**: INSERT ... ON CONFLICT DO UPDATE
4. **DELETE**: with WHERE clause
5. **Simple SELECT**: `SELECT name FROM "User"`
6. **Filtered SELECT**: with WHERE, ORDER BY, LIMIT, OFFSET
7. **Complex SELECT**: nested `$or` with `ILIKE`, `IN`, `>` operators
8. **Populate SELECT**: many-to-one JOIN across two entities
9. **AGGREGATE**: `GROUP BY` + `COUNT(*)` + `MAX()` + `HAVING` + `ORDER BY` + `LIMIT`

Sequelize is absent from the populate row: its `include` resolves associations during execution, so there is no compile-only path to measure. That is reported as `n/a` rather than as a zero.

> **Fairness note**: TypeORM and MikroORM are benchmarked at their **QueryBuilder** level (the fastest API available from them), skipping the entity-resolution overhead of their higher-level `find()` APIs. UQL generates SQL directly from its `find()`; there is no intermediate QueryBuilder layer. This means the benchmark is actually **more generous** to TypeORM and MikroORM than real-world usage would be.

### Round trip

One ordered lifecycle per iteration against a real database, with the fixture reset before each pass. The steps are a lifecycle rather than independent cases, so they run in order: resetting between them would erase the state each read exists to verify.

Knex and Kysely have no relation loading, so their nested step is the manual grouping a user would write by hand. Counting that against them would be measuring a feature they do not claim.

Entries are **interleaved and rotated** rather than run one at a time: each entry takes every position across the run. Running each to completion made the result depend on declaration order, since the first absorbed process-wide JIT warmup while later ones ran against a larger heap.

## Methodology

### Environment

| Detail  | Value                  |
| ------- | ---------------------- |
| CPU     | Apple Silicon M-series |
| Runtime | Node.js v24.18.1 (LTS) |
| OS      | macOS                  |
| Database | PostgreSQL 18.4        |
| Runs    | 3 averaged (generation), 250 interleaved iterations (round trip) |
| Date    | August 2026            |

### Fairness Guarantees

- All ORMs use the **same entities** (Company, and User: id, name, email, companyId, createdAt)
- All ORMs use their **latest stable version** at the time of testing (see versions below)
- Benchmarks run on the **latest LTS Node.js** (v24 at the time of writing)
- All generate **logically equivalent** queries, and all entries compile the **PostgreSQL** dialect (TypeORM initializes with a minimal `pg` stub via its `driver` option, the same injection seam [pg-mem](https://github.com/oguimbal/pg-mem) uses; the stub is only touched at startup, never in the measured path)
- Each uses its **idiomatic API** with no raw SQL shortcuts
- TypeORM's queries use safe `Brackets` queries (not raw string WHERE)
- UQL uses its decorators, which are the standard TC39 ones: no `experimentalDecorators`, no `emitDecoratorMetadata`, no `reflect-metadata`. They only run at class-definition time, never in the measured path
- MikroORM uses `defineEntity` (no decorator overhead) and `toQuery()`, which returns the parameterized `{ sql, params }` like the other entries; `getFormattedQuery()` is a debug helper that inlines parameters and is never on the execution hot path
- MikroORM uses `EntityCaseNamingStrategy` so it emits the same identifiers (`"User"`, `"companyId"`) as the other entries
- Sequelize uses `QueryGenerator` (no connection needed); it inlines escaped values because that is how Sequelize executes queries at runtime
- Every generation benchmark produces the **complete SQL string**, and every round-trip step asserts on the rows it got back

### ORM Versions

| Entry                               | Version |
| ----------------------------------- | ------- |
| [UQL](https://uql-orm.dev)          | 0.25.0  |
| [Sequelize](https://sequelize.org)  | 6.37.8  |
| [TypeORM](https://typeorm.io)       | 1.1.0   |
| [MikroORM](https://mikro-orm.io)    | 7.1.11  |
| [Drizzle](https://orm.drizzle.team) | 0.45.2  |
| [Knex](https://knexjs.org)          | 3.3.0   |
| [Kysely](https://kysely.dev)        | 0.29.4  |

## Contributing

Want to add another ORM? PRs welcome! Follow these steps:

1. Add the ORM as a `devDependency`
2. Add it to `src/schema.ts` with the same Company and User shape
3. Add a bench case to each `describe` block in `src/compiler.bench.ts`, and a flow in `scripts/flow-bench.ts`
4. Run `npm run bench` and `npm run bench.flow`; both tables regenerate themselves

## License

MIT
