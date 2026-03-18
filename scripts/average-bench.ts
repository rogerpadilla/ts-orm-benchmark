/**
 * Average 3 `vitest bench --outputJson` runs and regenerate `results.js` + `README.md`.
 *
 * Usage:
 *   bun scripts/average-bench.ts bench-1.json bench-2.json bench-3.json
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VitestBenchJson } from './bench-common';
import { averageKOpsPerCategoryAndEntry, categoryKeys, entries, syncResultsArtifactsFromData } from './bench-common';

function loadVitestRunJson(path: string): VitestBenchJson {
  return JSON.parse(readFileSync(path, 'utf8')) as VitestBenchJson;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error('Usage: bun scripts/average-bench.ts <run1.json> <run2.json> <run3.json>');
    process.exit(1);
  }

  const [j1, j2, j3] = args.map((p) => resolve(p));
  const data = averageKOpsPerCategoryAndEntry([loadVitestRunJson(j1), loadVitestRunJson(j2), loadVitestRunJson(j3)]);

  syncResultsArtifactsFromData(data);
  console.log('✅ results.js + README.md updated (averaged results)');

  // Results summary
  console.log('\nResults (K ops/sec):');
  for (const cat of categoryKeys) {
    console.log(`  ${cat}: ${entries.map((e, i) => `${e}: ${data[cat][i]}K`).join('  ')}`);
  }
}

main();
