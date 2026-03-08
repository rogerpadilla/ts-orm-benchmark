# ⚡ ts-orm-benchmark

Independent benchmark comparing SQL generation speed across TypeScript **ORMs** and **query builders**.

**No database required** — measures pure SQL generation speed, the overhead your ORM adds to every request.


## Results

> Node.js v24, Apple Silicon M-series, March 2026. All values in **ops/sec** (higher = better).

| Query Type                | [UQL](https://github.com/rogerpadilla/uql) | [Sequelize](https://github.com/sequelize/sequelize) | [TypeORM](https://github.com/typeorm/typeorm) | [MikroORM](https://github.com/mikro-orm/mikro-orm) | [Drizzle](https://github.com/drizzle-team/drizzle-orm) | [Knex](https://github.com/knex/knex) | [Kysely](https://github.com/kysely-org/kysely) |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| INSERT (10 rows)          | **618K** 🥇                                 | 209K                                                | 49K                                           | 50K                                                | 13K                                                    | 422K                                 | 202K                                           |
| UPDATE (SET+WHERE)        | **1,888K** 🥇                               | 242K                                                | 324K                                          | 121K                                               | 81K                                                    | 584K                                 | 813K                                           |
| UPSERT (ON CONFLICT)      | **710K** 🥇                                 | 336K                                                | 319K                                          | 133K                                               | 38K                                                    | 355K                                 | 341K                                           |
| DELETE (WHERE)            | **3,899K** 🥇                               | 1,350K                                              | 562K                                          | 150K                                               | 215K                                                   | 983K                                 | 1,320K                                         |
| SELECT (1 field)          | **4,019K** 🥇                               | 3,241K                                              | 849K                                          | 300K                                               | 242K                                                   | 1,006K                               | 1,595K                                         |
| SELECT (WHERE+SORT+LIMIT) | **1,264K** 🥇                               | 386K                                                | 387K                                          | 53K                                                | 62K                                                    | 500K                                 | 438K                                           |
| SELECT (complex $or)      | **678K** 🥇                                 | 155K                                                | 213K                                          | 22K                                                | 39K                                                    | 204K                                 | 225K                                           |

**UQL wins 7 out of 7** — even against standalone query builders (Knex, Kysely) that have zero entity/relation overhead.

### Speed Comparison - higher is better

| Entry     | Best          | Wins      |
| --------- | ------------- | --------- |
| **UQL**   | 47.5x faster  | **7/7** 🏆 |
| Knex      | 32.5x faster  | 0/7       |
| Sequelize | 16.1x faster  | 0/7       |
| Kysely    | 15.5x faster  | 0/7       |
| TypeORM   | 9.7x faster   | 0/7       |
| MikroORM  | 3.8x faster   | 0/7       |
| Drizzle   | 1.0x baseline | 0/7       |

### Why No Prisma?

- **Prisma**: Its query engine runs as a **separate Rust binary** — the JS client only builds JSON, not SQL. Architecturally incomparable.

## Quick Start

```bash
git clone https://github.com/rogerpadilla/ts-orm-benchmark.git
cd ts-orm-benchmark
npm install
npm run bench
```

## What's Measured

Each ORM generates equivalent SQL from the same logical query definition. We measure only the SQL generation step — no network, no database, no connection pooling. This isolates the pure ORM overhead that runs on every request.

7 query types are tested:
1. **Batch INSERT** — 10 rows in a single statement
2. **UPDATE** — SET 2 fields with WHERE clause
3. **UPSERT** — INSERT ... ON CONFLICT DO UPDATE
4. **DELETE** — with WHERE clause
5. **Simple SELECT** — `SELECT name FROM "User"`
6. **Filtered SELECT** — with WHERE, ORDER BY, LIMIT, OFFSET
7. **Complex SELECT** — nested `$or` with `ILIKE`, `IN`, `>` operators

> **Fairness note**: TypeORM and MikroORM are benchmarked at their **QueryBuilder** level (the fastest API available from them), skipping the entity-resolution overhead of their higher-level `find()` APIs. UQL generates SQL directly from its `find()` — there is no intermediate QueryBuilder layer. This means the benchmark is actually **more generous** to TypeORM and MikroORM than real-world usage would be.

## Methodology

### Fairness Guarantees

- ✅ All ORMs use the **same entity** (User: id, name, email, companyId, createdAt)
- ✅ All generate **logically equivalent** queries
- ✅ Each uses its **idiomatic API** — no raw SQL shortcuts
- ✅ TypeORM's queries use safe `Brackets` queries (not raw string WHERE)
- ✅ MikroORM uses `EntitySchema` (no decorator overhead)
- ✅ Sequelize uses `QueryGenerator` (no connection needed)
- ✅ Every benchmark produces the **complete SQL string**

### ORM Versions

| Entry     | Version |
| --------- | ------- |
| UQL       | 0.1.4   |
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
