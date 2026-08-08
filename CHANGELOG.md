# Changelog

## 0.7.0 - 2026-08-08

- **New benchmark: a real database round trip.** `scripts/flow-bench.ts` runs a full lifecycle against PostgreSQL 18.4 (insert, read, update, read, nested read, delete, read) and reports µs per step. Generation only measures building the statement; this measures the rest of what a request costs, including decoding rows and assembling relations. Each step asserts on the rows it gets back, so a step that silently does nothing fails instead of scoring well.
- Adds `raw pg` and `bun sql` as reference floors (hand-written driver code with manual row mapping), plus `UQL (bunSql)` and `Drizzle (bunSql)` to separate the cost of the driver from the cost of the query builder. Baselines are listed but excluded from win counts.
- **New generation category: `SELECT` with a m:1 JOIN** (`populate`), taking the count to 9. Sequelize is reported as `n/a` there rather than 0: its `include` resolves associations during execution, so there is no compile-only path to measure.
- Entries in the flow bench are **interleaved and rotated** rather than run to completion one at a time. Running each in turn made the result depend on declaration order, which is what made `UQL (bunSql)` look slower than `UQL` when measuring it alone showed the opposite.
- Reporting is now one pipeline over N datasets. `results.js` exposes `window.BENCH.datasets` carrying units, direction, entries, baselines and absent values, so `chart.html` no longer assumes higher-is-better or a fixed 7 entries; the chart gained a dataset switcher. README tables are regenerated between `<!-- bench:key -->` markers, since matching rows by label could not change a table's width.
- Fixed a ranking bug shared by the README and the chart: the best value was picked across every entry and then matched against non-baselines, so with reference floors present every real entry read `0/7`. Baselines are excluded before the winner is chosen. Ranking now sorts by wins, then total, rather than by the widest single-category lead, which had put an entry with one win above one with five.
- Dependencies: uql-orm 0.24.7 → 0.25.0.
- Removed `scripts/average-bench.ts`; `update-results.ts` takes any number of runs and averages them.

## 0.6.1 - 2026-08-08

- Dependencies: uql-orm 0.24.0 → 0.24.7, MikroORM 7.1.9 → 7.1.11, Biome 2.5.6 → 2.5.7. Every entry is at its latest published version.
- Results: re-ran on Node.js v24.18.1 (3 runs averaged). UQL is again fastest in all 8 categories, ~2.4x ahead of the runner-up on average. The generated SQL is unchanged from 0.6.0 for both upgraded ORMs, so the deltas are version-to-version speed, not a change in what is being compiled.

## 0.6.0 - 2026-08-02

- Dependencies: uql-orm 0.21.0 → 0.24.0; dropped `reflect-metadata` (TypeORM still pulls it in as its own dependency, and nothing here needs it directly); added `esbuild`.
- Tooling: removed `experimentalDecorators` and `emitDecoratorMetadata` from `tsconfig.json`. uql-orm 0.24 ships standard TC39 decorators, which need neither flag.
- Tooling: `vitest.config.ts` now transforms TypeScript with esbuild. Vite 8's own transformer (Oxc) implements no decorators and left `@Entity()` verbatim in the output, which Node rejected with a SyntaxError.
- Benchmark: `@Field`/`@Id` now state their type (`@Field({ type: String })`), mandatory in uql-orm 0.24 since nothing is reflected anymore. The generated SQL is byte-identical to 0.5.0's.
- Results: re-ran on Node.js v24.18.1 (3 runs averaged). UQL is again fastest in all 8 categories, ~2.4x ahead of the runner-up on average.

## 0.5.0 - 2026-07-30

- Dependencies: uql-orm 0.15.5 → 0.21.0, TypeORM 1.0.0 → 1.1.0, MikroORM 7.1.5 → 7.1.9, Kysely 0.29.3 → 0.29.4, Biome 2.5.3 → 2.5.6; added `reflect-metadata`, now an optional peer of uql-orm.
- Benchmark: split the AGGREGATE case into uql-orm's `$group` (columns) and `$agg` (computed aggregates); added an explicit `import 'reflect-metadata'` instead of relying on TypeORM's import to load it.
- Results: re-ran on Node.js v24.18.1 (3 runs averaged). UQL is again fastest in all 8 categories, ~2.3x ahead of the runner-up on average; batch INSERT went from a tie to 1.4x over Knex.

## 0.4.0 - 2026-07-12

- Dependencies: uql-orm 0.15.4 → 0.15.5.
- Results: re-ran (3 runs averaged) and regenerated `results.js` + `README.md`. UQL is again the fastest in all 8 categories.

## 0.3.0 - 2026-07-11

- Dependencies: updated all to latest (uql-orm 0.9.4 → 0.15.4, TypeScript 6.0.3 → 7.0.2, Kysely 0.29.2 → 0.29.3, Vitest 4.1.9 → 4.1.10, Biome 2.5.2 → 2.5.3); TypeORM, MikroORM, Sequelize, Drizzle, Knex, and pg were already at latest.
- Tooling: migrated `biome.json`'s deprecated `linter.rules.recommended` to `linter.rules.preset` via `biome migrate --write` (Biome 2.5.3 deprecated the old field).
- Tooling: TypeScript 7's overload resolution now infers the `insert()` generic from the payload array instead of the entity class when both are candidates, so `uqlDialect.insert(ctx, User, rows)` no longer type-checks against the optional-field `User` entity; pinned it explicitly (`uqlDialect.insert<User>(ctx, User, rows)`) rather than typing `rows` as `User[]`, which would have broken the other entries' stricter (non-optional) insert payload types.
- Results: re-ran on Node.js v24.18.0 (3 runs averaged) and regenerated `results.js` + `README.md`. At uql-orm 0.15.4, batch INSERT landed within run-to-run noise of Knex (it had closed the ~15-17% gap Knex held under 0.15.3); 0.4.0 tips it to a consistent UQL win. The other 7 categories held steady, UQL ahead by ~2.1x on average.

## 0.2.0 - 2026-07-02

- Fairness: all 7 entries now compile the PostgreSQL dialect. TypeORM initializes `type: 'postgres'` offline via a minimal `pg` stub through its `driver` option (the same injection seam pg-mem uses); MikroORM moved from `@mikro-orm/sqlite` to `@mikro-orm/postgresql` (v7 `init()` discovers metadata without connecting).
- Fairness: MikroORM is now measured via the parameterized `toQuery()` (returns `{ sql, params }` like the other entries) instead of `getFormattedQuery()`, a debug helper that inlines parameters and is never on the execution hot path.
- Fairness: MikroORM uses `EntityCaseNamingStrategy` so it emits the same identifiers (`"User"`, `"companyId"`) as the other entries.
- Dependencies: updated all (TypeORM 1.0.0, MikroORM 7.1.5, uql-orm 0.9.4, Kysely 0.29.2, Knex 3.3.0, Drizzle 0.45.2, Vitest 4.1.9, TypeScript 6.0.3); dropped `better-sqlite3` and `@types/better-sqlite3`, so the benchmark has no native modules and no database requirement at all.
- Tooling: added `"types": ["bun"]` to tsconfig (TypeScript 6 no longer auto-includes `@types/bun`, which silently broke uql-orm type inference).
- Results: re-ran on Node.js v24 and regenerated `results.js` + `README.md`.

## 0.1.2 — 2026-03-18

- Benchmark: `npm run bench` now runs the benchmark 3x, averages the results, and regenerates `results.js` + `README.md`.
- Benchmark scripts/publishing: centralized artifact generation + summary printing.

## 0.1.1 — 2026-03-18

- Benchmark: switched MikroORM fixture from `EntitySchema` to the v7 recommended `defineEntity` approach (decorator-free, same table/columns).
- Benchmark scripts/publishing: made `npm run bench` deterministic by switching `scripts/update-results.ts` from stdout parsing to `vitest --outputJson` parsing (removes “sometimes fails” root cause).
- Benchmark: ran the bench 3x and regenerated `results.js` and `README.md` from the averaged values.

