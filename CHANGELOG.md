# Changelog

## 0.3.0 - 2026-07-11

- Dependencies: updated all to latest (uql-orm 0.9.4 → 0.15.4, TypeScript 6.0.3 → 7.0.2, Kysely 0.29.2 → 0.29.3, Vitest 4.1.9 → 4.1.10, Biome 2.5.2 → 2.5.3); TypeORM, MikroORM, Sequelize, Drizzle, Knex, and pg were already at latest.
- Tooling: migrated `biome.json`'s deprecated `linter.rules.recommended` to `linter.rules.preset` via `biome migrate --write` (Biome 2.5.3 deprecated the old field).
- Tooling: TypeScript 7's overload resolution now infers the `insert()` generic from the payload array instead of the entity class when both are candidates, so `uqlDialect.insert(ctx, User, rows)` no longer type-checks against the optional-field `User` entity; pinned it explicitly (`uqlDialect.insert<User>(ctx, User, rows)`) rather than typing `rows` as `User[]`, which would have broken the other entries' stricter (non-optional) insert payload types.
- Results: re-ran on Node.js v24.18.0 (3 runs averaged) and regenerated `results.js` + `README.md`. Repeated the full benchmark 4 times to check batch INSERT specifically: UQL and Knex land within ~3% of each other every time and the win flips run to run (UQL 473/473/473/464K vs. Knex 473/472/487/477K across the 4 runs), a statistical tie now that 0.15.4 closed the larger, consistent ~15-17% gap Knex held under 0.15.3. Expect the README's win count on this one category to read 7/8 or 8/8 depending on which run last regenerated it; treat it as a tie rather than a ranking. The other 7 categories stayed stable across all 4 runs, UQL winning by the same ~2.1x margin throughout.

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

