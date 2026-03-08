# ⚡ ts-orm-benchmark

Independent benchmark comparing SQL generation speed across TypeScript **ORMs** — full ORMs only (entities, relations, hooks), not standalone query builders.

**No database required** — measures pure SQL generation speed, the overhead your ORM adds to every request.

> Standalone query builders (Kysely, Knex) are excluded — this is an apples-to-apples comparison of full ORMs that provide entity mapping, relations, hooks, and schema management.

## Results

> Node.js v24, Apple Silicon M-series, March 2026. All values in **ops/sec** (higher = better).

| Query Type                | [UQL](https://github.com/rogerpadilla/uql) | [Sequelize](https://github.com/sequelize/sequelize) | [TypeORM](https://github.com/typeorm/typeorm) | [MikroORM](https://github.com/mikro-orm/mikro-orm) | [Drizzle](https://github.com/drizzle-team/drizzle-orm) |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| INSERT (10 rows)          | **247K** 🥇                                 | 202K                                                | 45K                                           | 49K                                                | 13K                                                    |
| UPDATE (SET+WHERE)        | **805K** 🥇                                 | 233K                                                | 321K                                          | 122K                                               | 77K                                                    |
| SELECT (1 field)          | 1,557K                                     | **2,949K** 🥇                                        | 857K                                          | 301K                                               | 234K                                                   |
| SELECT (WHERE+SORT+LIMIT) | **524K** 🥇                                 | 388K                                                | 382K                                          | 55K                                                | 61K                                                    |
| SELECT (complex $or)      | **237K** 🥇                                 | 152K                                                | 211K                                          | 24K                                                | 41K                                                    |

**UQL wins 4 out of 5** — the only category it loses is the simplest SELECT, where Sequelize's raw string concatenation (no query object overhead) is faster.

### Speed Comparison - higher is better

| ORM           | Best          | Worst         | Wins      |
| ------------- | ------------- | ------------- | --------- |
| **UQL**       | 19.4x faster  | 1.0x faster   | **4/5** 🏆 |
| **Sequelize** | 12.6x faster  | 1.0x faster   | **1/5**   |
| TypeORM       | 5.5x faster   | 1.0x faster   | 0/5       |
| MikroORM      | 3.8x faster   | 1.0x baseline | 0/5       |
| Drizzle       | 1.0x baseline | 1.0x baseline | 0/5       |

### Memory Overhead - lower is better (heap after initialization)

| ORM       | Heap        | vs UQL |
| --------- | ----------- | ------ |
| **UQL**   | **0.44 MB** | —      |
| Sequelize | 1.30 MB     | 3.0x   |
| Drizzle   | 2.76 MB     | 6.3x   |
| MikroORM  | 3.64 MB     | 8.3x   |
| TypeORM   | 6.51 MB     | 14.8x  |

### Why No Prisma, Kysely, or Knex?

- **Prisma**: Its query engine runs as a **separate Rust binary** — the JS client only builds JSON, not SQL. Architecturally incomparable.
- **Kysely / Knex**: These are **standalone query builders**, not full ORMs. They don't provide entity mapping, relations, hooks, or schema management. Including them would be comparing apples to oranges.

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

### ORM Versions

| ORM       | Version |
| --------- | ------- |
| UQL       | 3.15.1  |
| Sequelize | 6.37.8  |
| TypeORM   | 0.3.28  |
| MikroORM  | 6.6.9   |
| Drizzle   | 0.45.1  |

## Contributing

Want to add another ORM? PRs welcome! Follow these steps:

1. Add the ORM as a `devDependency`
2. Define a `User` entity with the same 5 fields (id, name, email, companyId, createdAt)
3. Add a bench case to each `describe` block using the ORM's idiomatic API
4. Run `npm run bench` and update the results table in this README

## License

MIT
