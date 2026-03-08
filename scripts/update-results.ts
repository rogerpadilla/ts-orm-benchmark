/**
 * Parse vitest bench output and update results.json + README.md tables.
 *
 * Usage:
 *   npx vitest bench --run 2>&1 | bun scripts/update-results.ts
 *   # or
 *   npm run bench:update
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const resultsPath = resolve(root, 'results.json');
const readmePath = resolve(root, 'README.md');

// ── Category mapping: vitest describe label → results.json key ───────────────

const categoryMap: Record<string, string> = {
  'INSERT': 'insert',
  'UPDATE': 'update',
  'SELECT — simple': 'simple',
  'SELECT — WHERE': 'filter',
  'SELECT — complex': 'complex',
};

function matchCategory(line: string): string | undefined {
  for (const [pattern, key] of Object.entries(categoryMap)) {
    if (line.includes(pattern)) return key;
  }
  return undefined;
}

// ── Parse stdin ──────────────────────────────────────────────────────────────

const raw = readFileSync('/dev/stdin', 'utf-8');
const input = raw.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI color codes
const lines = input.split('\n');

const results = readFileSync(resultsPath, 'utf-8');
const json = JSON.parse(results);
const entries: string[] = json.entries;

let currentCategory: string | undefined;
const parsed: Record<string, Record<string, number>> = {};

for (const line of lines) {
  // Category header: ✓ src/compiler.bench.ts > SELECT — simple (1 field, no WHERE)
  if (line.includes('✓') && line.includes('>')) {
    currentCategory = matchCategory(line);
    if (currentCategory) parsed[currentCategory] = {};
    continue;
  }

  // Bench result: · UQL  3,909,237.75  0.0002  ...
  if (currentCategory && line.trim().startsWith('·')) {
    const match = line.match(/·\s+(\S+)\s+([\d,]+\.\d+)/);
    if (match) {
      const name = match[1];
      const hz = parseFloat(match[2].replace(/,/g, ''));
      const kOps = Math.round(hz / 1000);
      parsed[currentCategory][name] = kOps;
    }
  }
}

// ── Validate ─────────────────────────────────────────────────────────────────

const categoryKeys = Object.keys(json.data);
const missingCategories = categoryKeys.filter((k) => !parsed[k]);

if (missingCategories.length) {
  console.error(`Missing categories in bench output: ${missingCategories.join(', ')}`);
  process.exit(1);
}

for (const cat of categoryKeys) {
  const missingEntries = entries.filter((e) => !(e in parsed[cat]));
  if (missingEntries.length) {
    console.error(`Category "${cat}" missing entries: ${missingEntries.join(', ')}`);
    process.exit(1);
  }
}

// ── Update results.json ──────────────────────────────────────────────────────

for (const cat of categoryKeys) {
  json.data[cat] = entries.map((e) => parsed[cat][e]);
}

writeFileSync(resultsPath, JSON.stringify(json, null, 2) + '\n');
console.log('✅ results.json updated');

// Also generate results.js for chart.html (avoids CORS issues with file:// protocol)
const resultsJs = `// Auto-generated from results.json — do not edit manually\nwindow.BENCH_DATA = ${JSON.stringify({ entries: json.entries, data: json.data }, null, 2)};\n`;
writeFileSync(resolve(root, 'results.js'), resultsJs);
console.log('✅ results.js updated');

// ── Update README.md table ───────────────────────────────────────────────────

const readmeLabels: Record<string, string> = {
  insert: 'INSERT (10 rows)',
  update: 'UPDATE (SET+WHERE)',
  simple: 'SELECT (1 field)',
  filter: 'SELECT (WHERE+SORT+LIMIT)',
  complex: 'SELECT (complex $or)',
};


function formatOps(v: number): string {
  if (v >= 1000) {
    const thousands = Math.floor(v / 1000);
    const remainder = v % 1000;
    if (remainder === 0) return `${thousands},000K`;
    return `${thousands},${String(remainder).padStart(3, '0')}K`;
  }
  return `${v}K`;
}

let readme = readFileSync(readmePath, 'utf-8');

for (const cat of categoryKeys) {
  const values = json.data[cat] as number[];
  const max = Math.max(...values);
  const label = readmeLabels[cat];

  // Build the row: | LABEL | val1 | val2 | ... |
  const cells = values.map((v: number) => {
    const formatted = formatOps(v);
    return v === max ? `**${formatted}** 🥇` : formatted;
  });

  const row = `| ${label.padEnd(25)} | ${cells.join(' | '.padEnd(0))} |`;

  // Replace existing row by matching the label at start
  const rowRegex = new RegExp(`^\\|\\s*\\*?\\*?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm');
  readme = readme.replace(rowRegex, row);
}

// ── Update wins/speed table ──────────────────────────────────────────────────

const wins = new Array(entries.length).fill(0);
for (const cat of categoryKeys) {
  const values = json.data[cat] as number[];
  const maxIdx = values.indexOf(Math.max(...values));
  wins[maxIdx]++;
}

const totalCategories = categoryKeys.length;

// Compute "Nx faster" relative to slowest baseline (Drizzle is typically slowest)
const bestMultipliers = entries.map((_, i) => {
  const ratios = categoryKeys.map((cat) => {
    const values = json.data[cat] as number[];
    const min = Math.min(...values);
    return values[i] / min;
  });
  return Math.max(...ratios);
});

// Build speed comparison rows sorted by best multiplier descending
const speedRows = entries
  .map((name, i) => ({ name, wins: wins[i], best: bestMultipliers[i] }))
  .sort((a, b) => b.best - a.best);

const baselineName = speedRows[speedRows.length - 1].name;
const speedTableRows = speedRows.map((r) => {
  const bestStr = r.name === baselineName ? '1.0x baseline' : `${r.best.toFixed(1)}x faster`;
  const winsStr = r.wins > 0 ? `**${r.wins}/${totalCategories}** 🏆` : `0/${totalCategories}`;
  const nameStr = r.wins > 0 ? `**${r.name}**` : r.name;
  return `| ${nameStr.padEnd(13)} | ${bestStr.padEnd(13)} | ${winsStr.padEnd(9)} |`;
});

// Find and replace the speed comparison table body
const speedTableHeaderRegex = /\| Entry\s+\| Best\s+\| Wins\s+\|\n\| [-| ]+\|\n((?:\|.*\|\n)*)/;
const speedTableMatch = readme.match(speedTableHeaderRegex);
if (speedTableMatch) {
  const newBody = speedTableRows.join('\n') + '\n';
  readme = readme.replace(speedTableHeaderRegex, `| Entry         | Best          | Wins      |\n| ------------- | ------------- | --------- |\n${newBody}`);
}

// ── Update wins count in narrative ───────────────────────────────────────────

const totalWins = wins.reduce((a: number, b: number) => Math.max(a, b), 0);
readme = readme.replace(
  /\*\*UQL wins \d+ out of \d+\*\*/,
  `**UQL wins ${totalWins} out of ${totalCategories}**`,
);

writeFileSync(readmePath, readme);
console.log('✅ README.md updated');
console.log('\nResults (K ops/sec):');

for (const cat of categoryKeys) {
  const values = json.data[cat] as number[];
  const line = entries.map((e, i) => `${e}: ${values[i]}K`).join('  ');
  console.log(`  ${cat}: ${line}`);
}
