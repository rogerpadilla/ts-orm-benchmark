import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type CategoryKey = 'insert' | 'update' | 'upsert' | 'delete' | 'simple' | 'filter' | 'complex' | 'aggregate';

type VitestBenchJson = {
  files: Array<{
    filepath: string;
    groups: Array<{
      fullName: string;
      benchmarks: Array<{
        name: string;
        hz: number;
      }>;
    }>;
  }>;
};

const entries = ['UQL', 'Sequelize', 'TypeORM', 'MikroORM', 'Drizzle', 'Knex', 'Kysely'] as const;

const categories: Array<{
  key: CategoryKey;
  label: string;
  readmeLabel: string;
  group: 'write' | 'read';
  match: (fullName: string) => boolean;
}> = [
  {
    key: 'insert',
    label: 'INSERT — 10 rows in batch',
    readmeLabel: 'INSERT (10 rows)',
    group: 'write',
    match: (n) => n.includes('INSERT — batch (10 rows)'),
  },
  {
    key: 'update',
    label: 'UPDATE — SET + WHERE',
    readmeLabel: 'UPDATE (SET+WHERE)',
    group: 'write',
    match: (n) => n.includes('UPDATE — simple SET + WHERE'),
  },
  {
    key: 'upsert',
    label: 'UPSERT — ON CONFLICT by id',
    readmeLabel: 'UPSERT (ON CONFLICT)',
    group: 'write',
    match: (n) => n.includes('UPSERT — ON CONFLICT by id'),
  },
  {
    key: 'delete',
    label: 'DELETE — simple WHERE',
    readmeLabel: 'DELETE (WHERE)',
    group: 'write',
    match: (n) => n.includes('DELETE — simple WHERE'),
  },
  {
    key: 'simple',
    label: 'SELECT — 1 field',
    readmeLabel: 'SELECT (1 field)',
    group: 'read',
    match: (n) => n.includes('SELECT — simple (1 field, no WHERE)'),
  },
  {
    key: 'filter',
    label: 'SELECT — WHERE + SORT + LIMIT',
    readmeLabel: 'SELECT (WHERE+SORT+LIMIT)',
    group: 'read',
    match: (n) => n.includes('SELECT — WHERE + SORT + LIMIT'),
  },
  {
    key: 'complex',
    label: 'SELECT — Complex $or + operators',
    readmeLabel: 'SELECT (complex $or)',
    group: 'read',
    match: (n) => n.includes('SELECT — complex $or + operators'),
  },
  {
    key: 'aggregate',
    label: 'AGGREGATE — GROUP BY + COUNT + HAVING',
    readmeLabel: 'AGGREGATE (GROUP+HAVING)',
    group: 'read',
    match: (n) => n.includes('AGGREGATE — GROUP BY + COUNT + HAVING'),
  },
];

const categoryKeys = categories.map((c) => c.key);
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function formatOps(v: number): string {
  // v is already in "K ops/sec" units (e.g. 517 -> 517K)
  if (v >= 1000) {
    const thousands = Math.floor(v / 1000);
    const remainder = v % 1000;
    return remainder === 0 ? `${thousands},000K` : `${thousands},${String(remainder).padStart(3, '0')}K`;
  }
  return `${v}K`;
}

function loadVitestRunJson(path: string): VitestBenchJson {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as VitestBenchJson;
}

function extractKOpsPerCategoryAndEntry(vitestJson: VitestBenchJson): Record<CategoryKey, number[]> {
  const out: Record<CategoryKey, number[]> = {
    insert: [],
    update: [],
    upsert: [],
    delete: [],
    simple: [],
    filter: [],
    complex: [],
    aggregate: [],
  };

  const groupList = vitestJson.files.flatMap((f) => f.groups);
  const groupByCategory = new Map<CategoryKey, (typeof groupList)[number]>();

  for (const group of groupList) {
    for (const cat of categories) {
      if (cat.match(group.fullName)) {
        groupByCategory.set(cat.key, group);
        break;
      }
    }
  }

  for (const catKey of categoryKeys) {
    const group = groupByCategory.get(catKey);
    if (!group) throw new Error(`Could not find vitest group for category "${catKey}"`);

    const hzByEntry = new Map<string, number>();
    for (const b of group.benchmarks) {
      // If a benchmark case fails, Vitest may omit or null out `hz`.
      // We only average finite hz values and fail fast if anything is missing.
      if (typeof b.hz === 'number' && Number.isFinite(b.hz)) hzByEntry.set(b.name, b.hz);
    }

    const missing = entries.filter((e) => !hzByEntry.has(e));
    if (missing.length) throw new TypeError(`Category "${catKey}" missing entries: ${missing.join(', ')}`);

    // update-results.ts stores "K ops/sec" as Math.round(hz / 1000)
    out[catKey] = entries.map((e) => Math.round((hzByEntry.get(e) as number) / 1000));
  }

  return out;
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

  const data: Record<CategoryKey, number[]> = {} as any;
  for (const cat of categoryKeys) {
    data[cat] = entries.map((_, i) => avg3(d1[cat][i], d2[cat][i], d3[cat][i]));
  }

  // ── Write results.js ──────────────────────────────────────────────────────
  const resultsJs = [
    '// Auto-generated by scripts/average-bench.ts — do not edit manually',
    `window.BENCH_DATA = ${JSON.stringify(
      {
        entries: [...entries],
        categories: categories.map(({ key, label, group }) => ({ key, label, group })),
        data,
      },
      null,
      2,
    )};`,
    '',
  ].join('\n');
  writeFileSync(resolve(root, 'results.js'), resultsJs);

  // ── Update README.md ─────────────────────────────────────────────────────
  const readmePath = resolve(root, 'README.md');
  let readme = readFileSync(readmePath, 'utf8');

  for (const { key, readmeLabel } of categories) {
    const values = data[key];
    const max = Math.max(...values);
    const cells = values.map((v) => {
      const formatted = formatOps(v);
      return v === max ? `**${formatted}** 🥇` : formatted;
    });

    const row = `| ${readmeLabel.padEnd(25)} | ${cells.join(' | ')} |`;
    const rowRegex = new RegExp(`^\\|\\s*\\*?\\*?${readmeLabel.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}.*$`, 'm');
    readme = readme.replace(rowRegex, row);
  }

  // Speed comparison table + top winner line (same logic as update-results.ts)
  const wins = new Array(entries.length).fill(0);
  for (const cat of categoryKeys) {
    const maxIdx = data[cat].indexOf(Math.max(...data[cat]));
    wins[maxIdx]++;
  }

  const bestMultipliers = entries.map((_, i) =>
    Math.max(...categoryKeys.map((cat) => data[cat][i] / Math.min(...data[cat]))),
  );

  const speedRows = entries
    .map((name, i) => ({ name, wins: wins[i], best: bestMultipliers[i] }))
    .sort((a, b) => b.best - a.best);

  const baselineName = speedRows.at(-1)!.name;
  const totalCategories = categoryKeys.length;
  const medals = ['🥇', '🥈', '🥉'];

  const speedTableRows = speedRows.map((r, i) => {
    const pos = medals[i] ? `${medals[i]} ${i + 1}` : `${i + 1}`;
    const bestStr = r.name === baselineName ? `${r.best.toFixed(1)}x baseline` : `${r.best.toFixed(1)}x faster`;
    const winsStr = r.wins > 0 ? `**${r.wins}/${totalCategories}** 🏆` : `0/${totalCategories}`;
    const nameStr = r.wins > 0 ? `**${r.name}**` : r.name;
    return `| ${pos.padEnd(4)} | ${nameStr.padEnd(13)} | ${bestStr.padEnd(13)} | ${winsStr.padEnd(9)} |`;
  });

  const speedTableHeaderRegex = /\| P\s+\| Entry\s+\| Best\s+\| Wins\s+\|\n\| [-| ]+\|\n((?:\|.*\|\n)*)/;
  if (readme.match(speedTableHeaderRegex)) {
    const header = `| P   | Entry         | Best          | Wins      |\n| --- | ------------- | ------------- | --------- |\n`;
    readme = readme.replace(speedTableHeaderRegex, header + speedTableRows.join('\n') + '\n');
  }

  const topWinnerIdx = wins.indexOf(Math.max(...wins));
  const topWinnerName = entries[topWinnerIdx];
  readme = readme.replace(
    /\*\*\w+ wins \d+ out of \d+\*\*/,
    `**${topWinnerName} wins ${wins[topWinnerIdx]} out of ${totalCategories}**`,
  );

  writeFileSync(readmePath, readme);
  console.log('✅ README.md updated (averaged results)');

  // Results summary
  console.log('\nResults (K ops/sec):');
  for (const cat of categoryKeys) {
    console.log(`  ${cat}: ${entries.map((e, i) => `${e}: ${data[cat][i]}K`).join('  ')}`);
  }

  // Keep generated artifacts formatter-clean.
  execSync('biome check --write --unsafe results.js README.md', { stdio: 'ignore' });
}

main();
