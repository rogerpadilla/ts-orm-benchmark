/**
 * Update `results.js` + `README.md` from Vitest benchmark JSON.
 *
 * Usage:
 *   npx vitest bench --run --outputJson bench-latest.json
 *   bun scripts/update-results.ts bench-latest.json
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VitestBenchJson } from './bench-common';
import { categoryKeys, entries, root, syncResultsArtifactsFromVitestJson } from './bench-common';

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: bun scripts/update-results.ts <vitest-bench-json-path>');
  process.exit(1);
}

const vitestJson = JSON.parse(readFileSync(jsonPath, 'utf8')) as VitestBenchJson;
const data = syncResultsArtifactsFromVitestJson(vitestJson);
console.log('✅ results.js + README.md updated');

// Results summary (printed for CI logs)
console.log('\nResults (K ops/sec):');
for (const catKey of categoryKeys) {
  console.log(`  ${catKey}: ${entries.map((e, i) => `${e}: ${data[catKey][i]}K`).join('  ')}`);
}

// ── Open chart in browser (local only) ───────────────────────────────────────
if (!process.env.CI) {
  const { exec } = await import('node:child_process');
  const chartPath = resolve(root, 'chart.html');
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} ${chartPath}`);
}
