# ⚡ ts-orm-benchmark

Independent benchmark comparing SQL generation speed across TypeScript **ORMs** and **query builders**.

**No database required** — measures pure SQL generation speed, the overhead your ORM adds to every request.


## Results

> Node.js v24, Apple Silicon M-series, March 2026. All values in **ops/sec** (higher = better).

| Query Type                | [UQL](https://github.com/rogerpadilla/uql) | [Sequelize](https://github.com/sequelize/sequelize) | [TypeORM](https://github.com/typeorm/typeorm) | [MikroORM](https://github.com/mikro-orm/mikro-orm) | [Drizzle](https://github.com/drizzle-team/drizzle-orm) | [Knex](https://github.com/knex/knex) | [Kysely](https://github.com/kysely-org/kysely) |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| INSERT (10 rows)          | **599K** 🥇                                 | 203K                                                | 49K                                           | 50K                                                | 13K                                                    | 408K                                 | 193K                                           |
| UPDATE (SET+WHERE)        | **1,816K** 🥇                               | 238K                                                | 316K                                          | 120K                                               | 80K                                                    | 594K                                 | 817K                                           |
| SELECT (1 field)          | **3,913K** 🥇                               | 3,149K                                              | 807K                                          | 292K                                               | 235K                                                   | 978K                                 | 1,547K                                         |
| SELECT (WHERE+SORT+LIMIT) | **1,186K** 🥇                               | 393K                                                | 381K                                          | 54K                                                | 61K                                                    | 486K                                 | 426K                                           |
| SELECT (complex $or)      | **591K** 🥇                                 | 154K                                                | 207K                                          | 24K                                                | 39K                                                    | 203K                                 | 220K                                           |

**UQL wins 5 out of 5** — even against standalone query builders (Knex, Kysely) that have zero entity/relation overhead.

### Speed Comparison - higher is better

| Entry     | Best          | Wins      |
| --------- | ------------- | --------- |
| **UQL**   | 46.1x faster  | **5/5** 🏆 |
| Kysely    | 6.6x faster   | 0/5       |
| Knex      | 5.7x faster   | 0/5       |
| Sequelize | 3.4x faster   | 0/5       |
| TypeORM   | 3.4x faster   | 0/5       |
| MikroORM  | 2.1x faster   | 0/5       |
| Drizzle   | 1.0x baseline | 0/5       |

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

5 query types are tested:
1. **Batch INSERT** — 10 rows in a single statement
2. **UPDATE** — SET 2 fields with WHERE clause
3. **Simple SELECT** — `SELECT name FROM "User"`
4. **Filtered SELECT** — with WHERE, ORDER BY, LIMIT, OFFSET
5. **Complex SELECT** — nested `$or` with `ILIKE`, `IN`, `>` operators

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
| UQL       | 0.1.1   |
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
