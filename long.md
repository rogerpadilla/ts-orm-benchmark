## I benchmarked every major TypeScript ORM. Here's what I found.

Pure SQL generation speed — no database, no network, no connection pool. Just the overhead your ORM adds to every single request.

7 entries: UQL, Sequelize, TypeORM, MikroORM, Drizzle, Knex, Kysely.
8 query types. 3 runs averaged. Apple Silicon M4.

---

### Methodology

- **Environment:** Node.js v24, Apple Silicon M4, 3 runs averaged.
- **Versions:** Latest stable of every ORM/QB as of March 2026.
- **Fairness:** Each ORM uses its most idiomatic API — QueryBuilder for TypeORM/MikroORM, which benefits them by skipping entity overhead.
- **What's measured:** Pure SQL string generation — no database, no I/O, no connection pool. This isolates ORM overhead only.
- **Why no Prisma?** Prisma is not a pure TypeScript/JavaScript ORM — only its client is JS/TS. The query engine is a separate Rust binary that builds SQL, making it architecturally incomparable and not even testable this way.

---

### The results

#### INSERT — 10 rows in batch

| Entry     | ops/sec | vs winner |
| --------- | ------- | --------- |
| UQL       | 606K 🥇 | —         |
| Knex      | 407K    | 0.67x     |
| Sequelize | 202K    | 0.33x     |
| Kysely    | 197K    | 0.33x     |
| MikroORM  | 50K     | 0.08x     |
| TypeORM   | 47K     | 0.08x     |
| Drizzle   | 13K     | 0.02x     |

#### UPDATE — SET + WHERE

| Entry     | ops/sec  | vs winner |
| --------- | -------- | --------- |
| UQL       | 1,817K 🥇 | —        |
| Kysely    | 819K     | 0.45x    |
| Knex      | 601K     | 0.33x    |
| TypeORM   | 321K     | 0.18x    |
| Sequelize | 234K     | 0.13x    |
| MikroORM  | 119K     | 0.07x    |
| Drizzle   | 81K      | 0.04x    |

#### UPSERT — ON CONFLICT by id

| Entry     | ops/sec | vs winner |
| --------- | ------- | --------- |
| UQL       | 693K 🥇 | —         |
| Knex      | 349K    | 0.50x     |
| Sequelize | 334K    | 0.48x     |
| Kysely    | 334K    | 0.48x     |
| TypeORM   | 316K    | 0.46x     |
| MikroORM  | 130K    | 0.19x     |
| Drizzle   | 38K     | 0.05x     |

#### DELETE — simple WHERE

| Entry     | ops/sec  | vs winner |
| --------- | -------- | --------- |
| UQL       | 3,642K 🥇 | —        |
| Sequelize | 1,349K   | 0.37x    |
| Kysely    | 1,290K   | 0.35x    |
| Knex      | 962K     | 0.26x    |
| TypeORM   | 542K     | 0.15x    |
| Drizzle   | 212K     | 0.06x    |
| MikroORM  | 148K     | 0.04x    |

#### SELECT — 1 field

| Entry     | ops/sec  | vs winner |
| --------- | -------- | --------- |
| UQL       | 3,994K 🥇 | —        |
| Sequelize | 3,143K   | 0.79x    |
| Kysely    | 1,559K   | 0.39x    |
| Knex      | 994K     | 0.25x    |
| TypeORM   | 817K     | 0.20x    |
| MikroORM  | 297K     | 0.07x    |
| Drizzle   | 238K     | 0.06x    |

#### SELECT — WHERE + SORT + LIMIT

| Entry     | ops/sec  | vs winner |
| --------- | -------- | --------- |
| UQL       | 1,200K 🥇 | —        |
| Knex      | 480K     | 0.40x    |
| Kysely    | 425K     | 0.35x    |
| Sequelize | 385K     | 0.32x    |
| TypeORM   | 355K     | 0.30x    |
| Drizzle   | 60K      | 0.05x    |
| MikroORM  | 46K      | 0.04x    |

#### SELECT — Complex $or + operators

| Entry     | ops/sec | vs winner |
| --------- | ------- | --------- |
| UQL       | 644K 🥇 | —         |
| Kysely    | 218K    | 0.34x     |
| Knex      | 199K    | 0.31x     |
| TypeORM   | 186K    | 0.29x     |
| Sequelize | 152K    | 0.24x     |
| Drizzle   | 35K     | 0.05x     |
| MikroORM  | 22K     | 0.03x     |

#### AGGREGATE — GROUP BY + COUNT + HAVING

| Entry     | ops/sec  | vs winner |
| --------- | -------- | --------- |
| UQL       | 1,489K 🥇 | —        |
| Sequelize | 407K     | 0.27x    |
| TypeORM   | 364K     | 0.24x    |
| Knex      | 284K     | 0.19x    |
| Kysely    | 227K     | 0.15x    |
| Drizzle   | 77K      | 0.05x    |
| MikroORM  | 64K      | 0.04x    |

---

### Three things that surprised me

**1. The slowest entry is a query builder, not an ORM.**

Drizzle — a "lightweight" query builder — is slower than Sequelize (a full ORM from 2014) in every single category. The functional expression-tree approach creates more intermediate objects than Sequelize's simple string concatenation.

**2. Standalone query builders can't beat a well-designed ORM.**

Knex and Kysely have zero entity/relation overhead. They're just SQL string builders. Yet UQL — a full ORM with entities, relations, and migrations — is faster than both in all 8 categories. The conventional wisdom that "ORMs are slow, query builders are fast" doesn't hold when the ORM is designed for performance from day one.

**3. MikroORM pays double.**

MikroORM uses Knex internally as its SQL generator. So every query goes through two compilation layers: MikroORM → Knex → SQL string. The result? MikroORM averages 4-5x slower than Knex alone. That's the cost of layering abstractions.

---

### Why UQL wins

Most ORMs figure out your schema at query time: "What table does `User` map to? What column is `companyId`? Is it nullable?" — they answer these questions on every single query.

UQL answers them once, precomputed at startup. Field-to-column mappings, table names, relation paths — all pre-computed into lookup tables before the first query runs. At query time, generating SQL is just reading from a cache.

The other difference: Allocation; when TypeORM builds a SELECT, it creates a QueryBuilder, then an expression tree, then walks the tree to produce SQL. UQL pushes SQL fragments directly into a string buffer — no intermediate objects, no garbage collection pressure.

---

### Does this matter in production?

Database latency is 1-50ms. ORM overhead is microseconds. So who cares?

You care at scale. At 1,000 requests/second:
- UQL adds **1 CPU-second** of ORM overhead
- MikroORM adds **20 CPU-seconds** — for the same queries

That's 20x more CPU burned on generating SQL strings — pure waste before a single byte hits the network. In serverless (where you pay per ms), that's your bill. In containers, that's your horizontal scaling cost.

---

Reproduce it yourself — no database needed, runs in seconds (PRs are welcome!):
**github.com/rogerpadilla/ts-orm-benchmark**

#typescript #orm #performance #nodejs #webdev
