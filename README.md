# ⚡ ts-orm-benchmark

Independent benchmark comparing SQL generation speed across TypeScript **ORMs** and **query builders**.

**No database required** — measures pure SQL generation speed, the overhead your ORM adds to every request.

**[Benchmark Charts](https://rogerpadilla.github.io/ts-orm-benchmark/chart.html)** 📊

## Results

> Node.js v24, Apple Silicon M-series, March 2026. All values in **ops/sec** (higher = better).

| Query Type                | [UQL](https://github.com/rogerpadilla/uql) | [Sequelize](https://github.com/sequelize/sequelize) | [TypeORM](https://github.com/typeorm/typeorm) | [MikroORM](https://github.com/mikro-orm/mikro-orm) | [Drizzle](https://github.com/drizzle-team/drizzle-orm) | [Knex](https://github.com/knex/knex) | [Kysely](https://github.com/kysely-org/kysely) |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| INSERT (10 rows)          | **606K** 🥇 | 202K | 47K | 50K | 13K | 407K | 197K |
| UPDATE (SET+WHERE)        | **1,817K** 🥇 | 234K | 321K | 119K | 81K | 601K | 819K |
| UPSERT (ON CONFLICT)      | **693K** 🥇 | 334K | 316K | 130K | 38K | 349K | 334K |
| DELETE (WHERE)            | **3,642K** 🥇 | 1,349K | 542K | 148K | 212K | 962K | 1,290K |
| SELECT (1 field)          | **3,994K** 🥇 | 3,143K | 817K | 297K | 238K | 994K | 1,559K |
| SELECT (WHERE+SORT+LIMIT) | **1,200K** 🥇 | 385K | 355K | 46K | 60K | 480K | 425K |
| SELECT (complex $or)      | **644K** 🥇 | 152K | 186K | 22K | 35K | 199K | 218K |
| AGGREGATE (GROUP+HAVING)  | **1,489K** 🥇 | 407K | 364K | 64K | 77K | 284K | 227K |

**UQL wins 8 out of 8** — even against standalone query builders (Knex, Kysely) that have zero entity/relation overhead.

### Speed Comparison - higher is better

| P   | Entry         | Best          | Wins      |
| --- | ------------- | ------------- | --------- |
| 🥇 1 | **UQL**       | 46.6x faster  | **8/8** 🏆 |
| 🥈 2 | Knex          | 31.3x faster  | 0/8       |
| 🥉 3 | Sequelize     | 15.5x faster  | 0/8       |
| 4    | Kysely        | 15.2x faster  | 0/8       |
| 5    | TypeORM       | 8.5x faster   | 0/8       |
| 6    | MikroORM      | 3.8x faster   | 0/8       |
| 7    | Drizzle       | 1.0x baseline | 0/8       |

### Why No Prisma?

- **Prisma**: Its query engine runs as a **separate Rust binary** — the JS client only builds JSON, not SQL. Architecturally incomparable.

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
| UQL       | 0.2.3   |
| Sequelize | 6.37.8  |
| TypeORM   | 0.3.28  |
| MikroORM  | 6.6.9   |
| Drizzle   | 0.45.1  |
| Knex      | 3.1.0   |
| Kysely    | 0.28.11 |

## Contributing

Want to add another ORM? PRs welcome! Follow these steps:

1. Add the ORM as a `devDependency`
2. Define a `User` entity with the same 5 fields (id, name, email, companyId, createdAt)
3. Add a bench case to each `describe` block using the ORM's idiomatic API
4. Run `npm run bench` and update the results table in this README

## License

MIT
