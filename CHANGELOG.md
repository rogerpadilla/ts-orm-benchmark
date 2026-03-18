# Changelog

## 0.1.2 — 2026-03-18

- Benchmark: `npm run bench` now runs the benchmark 3x, averages the results, and regenerates `results.js` + `README.md`.
- Benchmark scripts/publishing: centralized artifact generation + summary printing.

## 0.1.1 — 2026-03-18

- Benchmark: switched MikroORM fixture from `EntitySchema` to the v7 recommended `defineEntity` approach (decorator-free, same table/columns).
- Benchmark scripts/publishing: made `npm run bench` deterministic by switching `scripts/update-results.ts` from stdout parsing to `vitest --outputJson` parsing (removes “sometimes fails” root cause).
- Benchmark: ran the bench 3x and regenerated `results.js` and `README.md` from the averaged values.

