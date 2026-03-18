import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CategoryKey = 'insert' | 'update' | 'upsert' | 'delete' | 'simple' | 'filter' | 'complex' | 'aggregate';

export const entries = ['UQL', 'Sequelize', 'TypeORM', 'MikroORM', 'Drizzle', 'Knex', 'Kysely'] as const;
export const categoryKeys = [
  'insert',
  'update',
  'upsert',
  'delete',
  'simple',
  'filter',
  'complex',
  'aggregate',
] as const satisfies readonly CategoryKey[];

export const categories = [
  {
    key: 'insert',
    label: 'INSERT — 10 rows in batch',
    readmeLabel: 'INSERT (10 rows)',
    group: 'write' as const,
    match: (fullName: string) => fullName.includes('INSERT — batch (10 rows)'),
  },
  {
    key: 'update',
    label: 'UPDATE — SET + WHERE',
    readmeLabel: 'UPDATE (SET+WHERE)',
    group: 'write' as const,
    match: (fullName: string) => fullName.includes('UPDATE — simple SET + WHERE'),
  },
  {
    key: 'upsert',
    label: 'UPSERT — ON CONFLICT by id',
    readmeLabel: 'UPSERT (ON CONFLICT)',
    group: 'write' as const,
    match: (fullName: string) => fullName.includes('UPSERT — ON CONFLICT by id'),
  },
  {
    key: 'delete',
    label: 'DELETE — simple WHERE',
    readmeLabel: 'DELETE (WHERE)',
    group: 'write' as const,
    match: (fullName: string) => fullName.includes('DELETE — simple WHERE'),
  },
  {
    key: 'simple',
    label: 'SELECT — 1 field',
    readmeLabel: 'SELECT (1 field)',
    group: 'read' as const,
    match: (fullName: string) => fullName.includes('SELECT — simple (1 field, no WHERE)'),
  },
  {
    key: 'filter',
    label: 'SELECT — WHERE + SORT + LIMIT',
    readmeLabel: 'SELECT (WHERE+SORT+LIMIT)',
    group: 'read' as const,
    match: (fullName: string) => fullName.includes('SELECT — WHERE + SORT + LIMIT'),
  },
  {
    key: 'complex',
    label: 'SELECT — Complex $or + operators',
    readmeLabel: 'SELECT (complex $or)',
    group: 'read' as const,
    match: (fullName: string) => fullName.includes('SELECT — complex $or + operators'),
  },
  {
    key: 'aggregate',
    label: 'AGGREGATE — GROUP BY + COUNT + HAVING',
    readmeLabel: 'AGGREGATE (GROUP+HAVING)',
    group: 'read' as const,
    match: (fullName: string) => fullName.includes('AGGREGATE — GROUP BY + COUNT + HAVING'),
  },
] as const;

export type VitestBenchJson = {
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

export const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatOps(v: number): string {
  // v is already in "K ops/sec" units (e.g. 517 -> 517K)
  if (v >= 1000) {
    const thousands = Math.floor(v / 1000);
    const remainder = v % 1000;
    return remainder === 0 ? `${thousands},000K` : `${thousands},${String(remainder).padStart(3, '0')}K`;
  }
  return `${v}K`;
}

function findCategoryFromFullName(fullName: string): CategoryKey | null {
  const cat = categories.find((c) => c.match(fullName));
  return cat ? cat.key : null;
}

export function extractKOpsPerCategoryAndEntry(vitestJson: VitestBenchJson): Record<CategoryKey, number[]> {
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

  const groupsWithCategory = groupList
    .map((group) => {
      const catKey = findCategoryFromFullName(group.fullName);
      return catKey ? { catKey, group } : null;
    })
    .filter((x): x is { catKey: CategoryKey; group: (typeof groupList)[number] } => Boolean(x));

  const grouped = Map.groupBy(groupsWithCategory, (x) => x.catKey);

  for (const catKey of categoryKeys) {
    const candidates = grouped.get(catKey);
    if (!candidates || candidates.length === 0) {
      throw new Error(`Could not find vitest group for category "${catKey}"`);
    }
    if (candidates.length > 1) {
      throw new Error(`Multiple vitest groups matched category "${catKey}".`);
    }

    const group = candidates[0]!.group;

    const hzByEntry = new Map<string, number>();
    for (const b of group.benchmarks) {
      // If a benchmark case fails, Vitest may omit or null out `hz`.
      // We only average finite hz values and fail fast if anything is missing.
      if (typeof b.hz === 'number' && Number.isFinite(b.hz)) hzByEntry.set(b.name, b.hz);
    }

    const missing = entries.filter((e) => !hzByEntry.has(e));
    if (missing.length) {
      throw new TypeError(`Category "${catKey}" missing entries or invalid hz: ${missing.join(', ')}`);
    }

    // update-results.ts stores "K ops/sec" as Math.round(hz / 1000)
    out[catKey] = entries.map((e) => Math.round((hzByEntry.get(e) as number) / 1000));
  }

  return out;
}

export function generateResultsJs(data: Record<CategoryKey, number[]>): string {
  const benchData = {
    entries: [...entries],
    categories: categories.map(({ key, label, group }) => ({ key, label, group })),
    data,
  };

  return [
    '// Auto-generated by scripts/update-results.ts — do not edit manually',
    `window.BENCH_DATA = ${JSON.stringify(benchData, null, 2)};`,
    '',
  ].join('\n');
}

export function updateReadme(readme: string, data: Record<CategoryKey, number[]>): string {
  // Category rows (the 8 tables)
  for (const { key, readmeLabel } of categories) {
    const values = data[key];
    const max = Math.max(...values);
    const cells = values.map((v) => {
      const formatted = formatOps(v);
      return v === max ? `**${formatted}** 🥇` : formatted;
    });

    const row = `| ${readmeLabel.padEnd(25)} | ${cells.join(' | ')} |`;
    const rowRegex = new RegExp(`^\\|\\s*\\*?\\*?${escapeRegExp(readmeLabel)}.*$`, 'm');
    readme = readme.replace(rowRegex, row);
  }

  // Speed comparison table + top winner line
  const wins = new Array(entries.length).fill(0);
  for (const catKey of categoryKeys) {
    const maxIdx = data[catKey].indexOf(Math.max(...data[catKey]));
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

  return readme;
}

export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeFile(path: string, contents: string): void {
  writeFileSync(path, contents);
}
