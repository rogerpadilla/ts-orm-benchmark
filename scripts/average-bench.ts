/**
 * Average 3 `vitest bench --outputJson` runs and regenerate `results.js` + `README.md`.
 *
 * Usage:
 *   bun scripts/average-bench.ts bench-1.json bench-2.json bench-3.json
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

function loadVitestRunJson(path: string): VitestBenchJson {
  return JSON.parse(readFileSync(path, 'utf8')) as VitestBenchJson;
}

function avg3(a: number, b: number, c: number) {
  return Math.round((a + b + c) / 3);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error('Usage: bun scripts/average-bench.ts <run1.json> <run2.json> <run3.json>');
    process.exit(1);
  }

  const [j1, j2, j3] = args.map((p) => resolve(p));
  const d1 = extractKOpsPerCategoryAndEntry(loadVitestRunJson(j1));
  const d2 = extractKOpsPerCategoryAndEntry(loadVitestRunJson(j2));
  const d3 = extractKOpsPerCategoryAndEntry(loadVitestRunJson(j3));

  const data: Record<(typeof categoryKeys)[number], number[]> = {} as any;
  for (const cat of categoryKeys) {
    data[cat] = entries.map((_, i) => avg3(d1[cat][i], d2[cat][i], d3[cat][i]));
  }

  // Write outputs
  const resultsJsPath = resolve(root, 'results.js');
  const readmePath = resolve(root, 'README.md');

  writeFileSync(resultsJsPath, generateResultsJs(data));

  let readme = readFileSync(readmePath, 'utf8');
  readme = updateReadme(readme, data);
  writeFileSync(readmePath, readme);

  console.log('✅ README.md updated (averaged results)');

  // Results summary
  console.log('\nResults (K ops/sec):');
  for (const cat of categoryKeys) {
    console.log(`  ${cat}: ${entries.map((e, i) => `${e}: ${data[cat][i]}K`).join('  ')}`);
  }

  execSync('biome check --write --unsafe results.js README.md', { stdio: 'ignore' });
}

main();
