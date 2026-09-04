# Changelog

## Unreleased

**New: a memory half.** `bun run bench.memory` weighs what each entry allocates per lifecycle, floored against `raw pg` like the timing tables. Node, one process per entry, nothing collected on purpose. UQL adds +201KB, MikroORM +3618KB.

- Drizzle's flat type-safety probes moved to `db.select()`, the builder its timed read uses: it had been timed on one API and scored on the other. 8/10 to 9/10.
- Dependencies: uql-orm 0.37.1 to 0.39.0.

## 0.11.0 - 2026-09-02

- Dependencies: uql-orm 0.33.0 to 0.37.1, TypeORM 1.1.0 to 1.1.1.
- The database runs natively, never in a container: on macOS that puts a VM between client and server, and the latency lands in `Adds` instead of cancelling against the floor. The method says so now.
- Results: UQL still adds the least, +186µs on Bun SQL and +234µs on `pg`. The three runtimes sit 313µs apart at p50 on `raw pg`, Deno now leading the median as well as the tail. Type-safety scores unchanged.

## 0.10.0 - 2026-08-29

**New: a type-safety half.** `bun run bench.types` writes ten ordinary mistakes - a misspelled column in a projection, a filter on a column that is not there, a text operator on a number, a read of a column the projection left out - in each ORM's own API, and reports which the compiler refuses. Each file is compiled twice, once as written and once corrected, so a mark is green only when the mistake errors and the correction is clean.

- UQL catches all 10, the only one that does; MikroORM, Prisma and TypeORM take 9, Drizzle 8, Sequelize 5. Scored on TypeScript 7.0.2; two red marks are checks TypeScript 6.0 stopped making, which the README explains. Ties break alphabetically, not by who wrote the benchmark.

**Fairness audit.** Every entry is now timed and scored through the same API, and fetches the same columns. Neither gap was costing us:

- TypeORM's nested read hydrated five user columns where everyone else took two. Its nested step drops 469µs to 414µs, its total +751 to +692µs.
- MikroORM was timed on `createQueryBuilder` but scored on `em.*`. Now on the EntityManager for six of seven steps, measured as no penalty.
- Sequelize and TypeORM gained typed models the timed half had been doing without.
- Drizzle keeps one split, timed on `db.select()` and scored on `db.query`. The README prices it and says why it stays.

**Also:**

- The README shows the queries it timed, lifted out of `scripts/flows.ts` at generation time rather than copied.
- `flow-bench.ts` asserted each step on the first round only, while the README claimed every round. It now does; the check runs after the timer stops, so the gate bought nothing.
- Deno gets `--min-dep-age=0`, which refuses npm versions published in the last 24 hours and cost the whole runtime table on the day an ORM shipped.
- Pinned every dependency that can move a published number, `typescript` included: it scores the type-safety table.
- Dependencies: uql-orm 0.30.0 to 0.32.1, Prisma 7.9.1 to 7.10.0, MikroORM 7.1.13 to 7.1.14, Biome 2.5.10 to 2.5.11. uql-orm 0.32.0 narrows `findMany` to the selected fields, which is what takes it to 10 of 10 and what let the explicit `insertMany<User>` type argument go.
- Dropped the hand-kept claim that Prisma wraps its insert in a transaction, worth 88µs: its query log on 7.10.0 shows no `BEGIN`.
- Results: UQL still adds the least, +207µs on Bun SQL and +258µs on `pg`. TypeORM's nested-read fix moves it past Drizzle on `pg`, +662 against +697. The three runtimes sit 77µs apart at p50 on `raw pg`, and 803µs apart at p99.

## 0.9.0 - 2026-08-23

**New: the same lifecycle on Bun, Node and Deno.** `bun run bench.runtimes` builds one bundle with Bun and runs it on each runtime, so none is charged for its own TypeScript loader. All three measure the same seven entries; the `bunSql` ones sit out, since carrying three extra per round made Bun's p99 look twice as bad as it is.

- Bun's SQL client loads through a dynamic import, so the suite runs off Bun at all. CI exercises the non-Bun bundle to keep it that way.
- Scripts split by job, leaving `flow-bench.ts` as just the timing loop. Same output, byte for byte.
- Dependencies: uql-orm 0.28.1 to 0.30.0, MikroORM 7.1.12 to 7.1.13, Biome 2.5.8 to 2.5.10, @types/bun 1.3.14 to 1.4.0.
- Results: the runtimes land within 52µs at p50 on identical `raw pg` code, then separate in the tail. Picking the ORM still matters more than picking the runtime, 1791-2752µs against 798µs.

## 0.8.2 - 2026-08-10

- MikroORM forks a fresh `EntityManager` per operation instead of sharing one across the run, the pattern the nested step already used. A correctness fix; re-ran several times and measured no change either way.

## 0.8.1 - 2026-08-10

- Dependencies: uql-orm 0.25.1 to 0.26.0.
- Results: UQL (bunSql) still fastest at +273µs over the floor, UQL behind it at +334µs.

## 0.8.0 - 2026-08-09

Now a single benchmark: what each ORM costs on a real PostgreSQL round trip.

- Removed the SQL-generation benchmark. Measured properly, it accounted for under 0.5% of a real request.
- Removed Knex and Kysely. A query builder with no entities and no relation loading is not an ORM, and its nested step was hand-written grouping rather than a feature.
- Added Prisma, through the `pg` driver adapter on the same single connection as everything else.
- The headline is what an ORM adds over its own driver, not its total: totals span only 2.2x because every entry pays the same database cost.
- Numbers that change per run are generated and the prose around them stays qualitative, so a re-run cannot leave stale figures behind.

## 0.7.0 - 2026-08-08

- **New benchmark: a real database round trip.** `scripts/flow-bench.ts` runs a full lifecycle against PostgreSQL 18.4 and reports µs per step.
- Added `raw pg` and `bun sql` as reference floors, plus `UQL (bunSql)` and `Drizzle (bunSql)` to separate the driver's cost from the query builder's.

## 0.6.1 - 2026-08-08

- Dependencies: uql-orm 0.24.0 to 0.24.7, MikroORM 7.1.9 to 7.1.11, Biome 2.5.6 to 2.5.7.
- Results: UQL fastest in all 8, ~2.4x ahead on average. The generated SQL is unchanged for both upgraded ORMs, so the deltas are version-to-version speed rather than a change in what is compiled.

## 0.6.0 - 2026-08-02

- Dependencies: uql-orm 0.21.0 to 0.24.0; dropped `reflect-metadata`, added `esbuild`.
- Removed `experimentalDecorators` and `emitDecoratorMetadata` from `tsconfig.json`: uql-orm 0.24 ships standard TC39 decorators, which need neither.
- `vitest.config.ts` transforms TypeScript with esbuild. Vite 8's own transformer implements no decorators and left `@Entity()` verbatim, which Node rejected.
- `@Field`/`@Id` now state their type, mandatory in uql-orm 0.24 since nothing is reflected. The generated SQL is byte-identical to 0.5.0's.
- Results: UQL fastest in all 8, ~2.4x ahead on average.

## 0.5.0 - 2026-07-30

- Dependencies: uql-orm 0.15.5 to 0.21.0, TypeORM 1.0.0 to 1.1.0, MikroORM 7.1.5 to 7.1.9, Kysely 0.29.3 to 0.29.4, Biome 2.5.3 to 2.5.6; added `reflect-metadata`, now an optional peer of uql-orm.
- Split the AGGREGATE case into uql-orm's `$group` and `$agg`.
- Results: UQL fastest in all 8, ~2.3x ahead on average; batch INSERT went from a tie to 1.4x over Knex.

## 0.4.0 - 2026-07-12

- Dependencies: uql-orm 0.15.4 to 0.15.5.
- Results: UQL fastest in all 8.

## 0.3.0 - 2026-07-11

- Dependencies: everything to latest (uql-orm 0.9.4 to 0.15.4, TypeScript 6.0.3 to 7.0.2, Kysely 0.29.2 to 0.29.3, Vitest 4.1.9 to 4.1.10, Biome 2.5.2 to 2.5.3).
- TypeScript 7 infers `insert()`'s generic from the payload array rather than the entity class, so the call is pinned explicitly. Typing the rows instead would have broken the other entries' stricter insert payloads.
- Migrated `biome.json`'s deprecated `linter.rules.recommended` to `linter.rules.preset`.
- Results: batch INSERT tips to a consistent UQL win; the other 7 held steady, UQL ahead by ~2.1x on average.

## 0.2.0 - 2026-07-02

- Fairness: all 7 entries compile the PostgreSQL dialect. TypeORM initializes offline through a minimal `pg` stub, the same injection seam pg-mem uses; MikroORM moved from SQLite to `@mikro-orm/postgresql`.
- Fairness: MikroORM is measured through the parameterized `toQuery()` rather than `getFormattedQuery()`, a debug helper that inlines parameters and never runs on the hot path, and uses `EntityCaseNamingStrategy` so it emits the same identifiers as everyone else.
- Dependencies: updated all; dropped `better-sqlite3`, so the benchmark has no native modules and needs no database.
- Added `"types": ["bun"]` to tsconfig. TypeScript 6 no longer auto-includes `@types/bun`, which had silently broken uql-orm's inference.

## 0.1.2 - 2026-03-18

- `npm run bench` runs 3x, averages, and regenerates `results.js` and `README.md`.

## 0.1.1 - 2026-03-18

- MikroORM moved from `EntitySchema` to v7's recommended `defineEntity`, decorator-free with the same table and columns.
- `npm run bench` is deterministic: `scripts/update-results.ts` parses `vitest --outputJson` instead of stdout.
