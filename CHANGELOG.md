# Changelog

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

