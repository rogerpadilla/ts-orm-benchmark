# ⚡ ts-orm-benchmark

Independent benchmark comparing SQL generation speed across TypeScript **ORMs** and **query builders**.

**No database required** — measures pure SQL generation speed, the overhead your ORM adds to every request.

**[Benchmark Charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊

## Results

> Node.js v24, Apple Silicon M-series, March 2026. All values in **ops/sec** (higher = better).

| Query Type                | [UQL](https://uql-orm.dev) | [Sequelize](https://sequelize.org) | [TypeORM](https://typeorm.io) | [MikroORM](https://mikro-orm.io) | [Drizzle](https://orm.drizzle.team) | [Knex](https://knexjs.org) | [Kysely](https://kysely.dev) |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| INSERT (10 rows)          | **610K** 🥇 | 200K | 47K | 67K | 13K | 427K | 192K |
| UPDATE (SET+WHERE)        | **1,829K** 🥇 | 237K | 316K | 216K | 80K | 628K | 809K |
| UPSERT (ON CONFLICT)      | **657K** 🥇 | 331K | 315K | 241K | 37K | 359K | 335K |
| DELETE (WHERE)            | **3,613K** 🥇 | 1,340K | 550K | 268K | 211K | 1,036K | 1,287K |
| SELECT (1 field)          | **3,864K** 🥇 | 3,045K | 817K | 606K | 227K | 1,032K | 1,536K |
| SELECT (WHERE+SORT+LIMIT) | **1,202K** 🥇 | 387K | 374K | 76K | 60K | 515K | 426K |
| SELECT (complex $or)      | **637K** 🥇 | 154K | 203K | 28K | 35K | 220K | 212K |
| AGGREGATE (GROUP+HAVING)  | **1,488K** 🥇 | 417K | 363K | 71K | 73K | 297K | 215K |

**UQL wins 8 out of 8** — even against standalone query builders (Knex, Kysely) that have zero entity/relation overhead.

### Speed Comparison - higher is better

| P   | Entry         | Best          | Wins      |
| --- | ------------- | ------------- | --------- |
| 🥇 1 | **UQL**       | 46.9x faster  | **8/8** 🏆 |
| 🥈 2 | Knex          | 32.8x faster  | 0/8       |
| 🥉 3 | Sequelize     | 15.4x faster  | 0/8       |
| 4    | Kysely        | 14.8x faster  | 0/8       |
| 5    | TypeORM       | 8.5x faster   | 0/8       |
| 6    | MikroORM      | 6.5x faster   | 0/8       |
| 7    | Drizzle       | 1.3x baseline | 0/8       |

### Why No Prisma?

- **Prisma**: Even in v7 ("Rust-free"), the Query Compiler that generates SQL is still **Rust compiled to WebAssembly** — not pure JS/TS. Additionally, Prisma exposes no public `.toSQL()` or `.compile()` API, making it untestable in this benchmark.

## Quick Start

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
bun install
npm run bench   # runs benchmarks → auto-updates results.js + README
```

## What's Measured

Each ORM generates equivalent SQL from the same logical query definition. We measure only the SQL generation step — no network, no database, no connection pooling. This isolates the pure ORM overhead that runs on every request.

8 query types are tested:
1. **Batch INSERT** — 10 rows in a single statement
2. **UPDATE** — SET 2 fields with WHERE clause
3. **UPSERT** — INSERT ... ON CONFLICT DO UPDATE
4. **DELETE** — with WHERE clause
5. **Simple SELECT** — `SELECT name FROM "User"`
6. **Filtered SELECT** — with WHERE, ORDER BY, LIMIT, OFFSET
7. **Complex SELECT** — nested `$or` with `ILIKE`, `IN`, `>` operators
8. **AGGREGATE** — `GROUP BY` + `COUNT(*)` + `MAX()` + `HAVING` + `ORDER BY` + `LIMIT`

> **Fairness note**: TypeORM and MikroORM are benchmarked at their **QueryBuilder** level (the fastest API available from them), skipping the entity-resolution overhead of their higher-level `find()` APIs. UQL generates SQL directly from its `find()` — there is no intermediate QueryBuilder layer. This means the benchmark is actually **more generous** to TypeORM and MikroORM than real-world usage would be.

## Methodology

### Environment

| Detail       | Value                     |
| ------------ | ------------------------- |
| CPU          | Apple Silicon M-series    |
| Runtime      | Node.js v24 (LTS)        |
| OS           | macOS                     |
| Runs         | 3 averaged                |
| Date         | March 2026                |

### Fairness Guarantees

- ✅ All ORMs use the **same entity** (User: id, name, email, companyId, createdAt)
- ✅ All ORMs use their **latest stable version** at the time of testing (see versions below)
- ✅ Benchmarks run on the **latest LTS Node.js** (v24 at the time of writing)
- ✅ All generate **logically equivalent** queries
- ✅ Each uses its **idiomatic API** — no raw SQL shortcuts
- ✅ TypeORM's queries use safe `Brackets` queries (not raw string WHERE)
- ✅ MikroORM uses `EntitySchema` (no decorator overhead)
- ✅ Sequelize uses `QueryGenerator` (no connection needed)
- ✅ Every benchmark produces the **complete SQL string**

### ORM Versions

| Entry     | Version |
| --------- | ------- |
| [UQL](https://uql-orm.dev)       | 0.5.3   |
| [Sequelize](https://sequelize.org) | 6.37.8  |
| [TypeORM](https://typeorm.io)   | 0.3.28  |
| [MikroORM](https://mikro-orm.io)  | 7.0.3   |
| [Drizzle](https://orm.drizzle.team)   | 0.45.1  |
| [Knex](https://knexjs.org)      | 3.1.0   |
| [Kysely](https://kysely.dev)    | 0.28.12 |

## Contributing

Want to add another ORM? PRs welcome! Follow these steps:

1. Add the ORM as a `devDependency`
2. Define a `User` entity with the same 5 fields (id, name, email, companyId, createdAt)
3. Add a bench case to each `describe` block using the ORM's idiomatic API
4. Run `npm run bench` and update the results table in this README

## License

MIT
