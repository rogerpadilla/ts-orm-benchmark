/**
 * Update `results.js` + `README.md` from Vitest benchmark JSON.
 *
 * Usage:
 *   npx vitest bench --run --outputJson bench-latest.json
 *   bun scripts/update-results.ts bench-latest.json
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VitestBenchJson } from './bench-common';
import {
  categoryKeys,
  entries,
  extractKOpsPerCategoryAndEntry,
  generateResultsJs,
  root,
  updateReadme,
} from './bench-common';

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: bun scripts/update-results.ts <vitest-bench-json-path>');
  process.exit(1);
}

const vitestJson = JSON.parse(readFileSync(jsonPath, 'utf8')) as VitestBenchJson;
const data = extractKOpsPerCategoryAndEntry(vitestJson);

const resultsJsPath = resolve(root, 'results.js');
const readmePath = resolve(root, 'README.md');

writeFileSync(resultsJsPath, generateResultsJs(data));
console.log('✅ results.js updated');

let readme = readFileSync(readmePath, 'utf8');
readme = updateReadme(readme, data);
writeFileSync(readmePath, readme);
console.log('✅ README.md updated');

// Results summary (printed for CI logs)
console.log('\nResults (K ops/sec):');
for (const catKey of categoryKeys) {
  console.log(`  ${catKey}: ${entries.map((e, i) => `${e}: ${data[catKey][i]}K`).join('  ')}`);
}

// Keep generated artifacts formatter-clean.
execSync('biome check --write --unsafe results.js README.md', { stdio: 'ignore' });

// ── Open chart in browser (local only) ───────────────────────────────────────
if (!process.env.CI) {
  const { exec } = await import('node:child_process');
  const chartPath = resolve(root, 'chart.html');
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} ${chartPath}`);
}
