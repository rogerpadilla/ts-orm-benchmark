# ⚡ ts-orm-benchmark

Independent benchmark comparing SQL generation speed across TypeScript **ORMs** and **query builders**.

**No database required**: measures pure SQL generation speed, the overhead your ORM adds to every request.

**[Benchmark Charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊

## Results

> Node.js v24, Apple Silicon M-series, July 2026. All values in **ops/sec** (higher = better).

| Query Type                | [UQL](https://uql-orm.dev) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [MikroORM](https://mikro-orm.io) | [Drizzle](https://orm.drizzle.team) | [Knex](https://knexjs.org) | [Kysely](https://kysely.dev) |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| INSERT (10 rows)          | **565K** 🥇 | 201K | 41K | 111K | 13K | 477K | 194K |
| UPDATE (SET+WHERE)        | **1,772K** 🥇 | 242K | 289K | 222K | 79K | 711K | 812K |
| UPSERT (ON CONFLICT)      | **656K** 🥇 | 334K | 269K | 265K | 37K | 443K | 339K |
| DELETE (WHERE)            | **3,525K** 🥇 | 1,361K | 521K | 261K | 209K | 1,090K | 1,269K |
| SELECT (1 field)          | **3,472K** 🥇 | 3,052K | 585K | 566K | 229K | 1,129K | 1,551K |
| SELECT (WHERE+SORT+LIMIT) | **1,190K** 🥇 | 403K | 284K | 73K | 60K | 614K | 412K |
| SELECT (complex $or)      | **612K** 🥇 | 155K | 162K | 27K | 35K | 247K | 218K |
| AGGREGATE (GROUP+HAVING)  | **1,431K** 🥇 | 410K | 286K | 72K | 74K | 310K | 206K |

**UQL wins 8 out of 8**, even against standalone query builders (Knex, Kysely) that have zero entity/relation overhead.

### Speed Comparison - higher is better

| P   | Entry         | Best          | Wins      |
| --- | ------------- | ------------- | --------- |
| 🥇 1 | **UQL**       | 43.5x faster  | **8/8** 🏆 |
| 🥈 2 | Knex          | 36.7x faster  | 0/8       |
| 🥉 3 | Sequelize     | 15.5x faster  | 0/8       |
| 4    | Kysely        | 14.9x faster  | 0/8       |
| 5    | MikroORM      | 8.5x faster   | 0/8       |
| 6    | TypeORM       | 7.3x faster   | 0/8       |
| 7    | Drizzle       | 1.3x baseline | 0/8       |

### Why No Prisma?

- **Prisma**: Even in v7 ("Rust-free"), the Query Compiler that generates SQL is still **Rust compiled to WebAssembly**, not pure JS/TS. Additionally, Prisma exposes no public `.toSQL()` or `.compile()` API, making it untestable in this benchmark.

## Quick Start

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install
npm run bench   # runs benchmarks → auto-updates results.js + README
```

## What's Measured

Each ORM generates equivalent SQL from the same logical query definition. We measure only the SQL generation step: no network, no database, no connection pooling. This isolates the pure ORM overhead that runs on every request.

8 query types are tested:
1. **Batch INSERT**: 10 rows in a single statement
2. **UPDATE**: SET 2 fields with WHERE clause
3. **UPSERT**: INSERT ... ON CONFLICT DO UPDATE
4. **DELETE**: with WHERE clause
5. **Simple SELECT**: `SELECT name FROM "User"`
6. **Filtered SELECT**: with WHERE, ORDER BY, LIMIT, OFFSET
7. **Complex SELECT**: nested `$or` with `ILIKE`, `IN`, `>` operators
8. **AGGREGATE**: `GROUP BY` + `COUNT(*)` + `MAX()` + `HAVING` + `ORDER BY` + `LIMIT`

> **Fairness note**: TypeORM and MikroORM are benchmarked at their **QueryBuilder** level (the fastest API available from them), skipping the entity-resolution overhead of their higher-level `find()` APIs. UQL generates SQL directly from its `find()`; there is no intermediate QueryBuilder layer. This means the benchmark is actually **more generous** to TypeORM and MikroORM than real-world usage would be.

## Methodology

### Environment

| Detail       | Value                     |
| ------------ | ------------------------- |
| CPU          | Apple Silicon M-series    |
| Runtime      | Node.js v24 (LTS)        |
| OS           | macOS                     |
| Runs         | 3 averaged                |
| Date         | July 2026                 |

### Fairness Guarantees

- All ORMs use the **same entity** (User: id, name, email, companyId, createdAt)
- All ORMs use their **latest stable version** at the time of testing (see versions below)
- Benchmarks run on the **latest LTS Node.js** (v24 at the time of writing)
- All generate **logically equivalent** queries, and all entries compile the **PostgreSQL** dialect (TypeORM initializes with a minimal `pg` stub via its `driver` option, the same injection seam [pg-mem](https://github.com/oguimbal/pg-mem) uses; the stub is only touched at startup, never in the measured path)
- Each uses its **idiomatic API** with no raw SQL shortcuts
- TypeORM's queries use safe `Brackets` queries (not raw string WHERE)
- MikroORM uses `defineEntity` (no decorator overhead) and `toQuery()`, which returns the parameterized `{ sql, params }` like the other entries; `getFormattedQuery()` is a debug helper that inlines parameters and is never on the execution hot path
- MikroORM uses `EntityCaseNamingStrategy` so it emits the same identifiers (`"User"`, `"companyId"`) as the other entries
- Sequelize uses `QueryGenerator` (no connection needed); it inlines escaped values because that is how Sequelize executes queries at runtime
- Every benchmark produces the **complete SQL string**

### ORM Versions

| Entry     | Version |
| --------- | ------- |
| [UQL](https://uql-orm.dev)       | 0.9.4   |
| [Sequelize](https://sequelize.org) | 6.37.8  |
| [TypeORM](https://typeorm.io)   | 1.0.0   |
| [MikroORM](https://mikro-orm.io)  | 7.1.5   |
| [Drizzle](https://orm.drizzle.team)   | 0.45.2  |
| [Knex](https://knexjs.org)      | 3.3.0   |
| [Kysely](https://kysely.dev)    | 0.29.2  |

## Contributing

Want to add another ORM? PRs welcome! Follow these steps:

1. Add the ORM as a `devDependency`
2. Define a `User` entity with the same 5 fields (id, name, email, companyId, createdAt)
3. Add a bench case to each `describe` block using the ORM's idiomatic API
4. Run `npm run bench` and update the results table in this README

## License

MIT
