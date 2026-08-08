/**
 * Fold one or more `vitest bench --outputJson` runs into `results.js` and `README.md`.
 *
 * Several runs are averaged, which is how the generation numbers stay stable: tinybench keeps its state
 * per process, so repeating the whole run is the only way to spread a warm-up or a GC pause across the
 * measurement. (The flow bench needs none of this, since it interleaves its entries within one process.)
 *
 * Usage:
 *   npx vitest bench --run --outputJson bench-1.json
 *   bun scripts/update-results.ts bench-1.json [bench-2.json ...]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  averageGeneration,
  generationDataset,
  mergeDataset,
  printSummary,
  root,
  syncResultsArtifacts,
  type VitestBenchJson,
} from './bench-common.js';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('Usage: bun scripts/update-results.ts <run1.json> [run2.json ...]');
  process.exit(1);
}

const runs = paths.map((path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as VitestBenchJson);
const dataset = generationDataset(averageGeneration(runs));

syncResultsArtifacts(mergeDataset(dataset));
console.log(`results.js + README.md updated (${runs.length} run${runs.length > 1 ? 's' : ''})`);
printSummary(dataset);

if (!process.env.CI) {
  const { exec } = await import('node:child_process');
  const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${open} ${resolve(root, 'chart.html')}`);
}
