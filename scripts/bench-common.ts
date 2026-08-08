import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * `raw pg` and `bun sql` are reference floors, not competitors: hand-written driver code with manual row
 * mapping. The two `(bunSql)` rows are labelled because they swap the driver, not the ORM, and only UQL
 * and Drizzle ship a Bun SQL adapter, so reading them as an apples-to-apples win would be wrong.
 *
 * These live here rather than in `flow-bench.ts` so the dependency runs one way: the harness imports its
 * metadata from the reporting layer, not the reverse.
 */
export const FLOW_ENTRIES = [
  'raw pg',
  'bun sql',
  'UQL',
  'UQL (bunSql)',
  'Sequelize',
  'TypeORM',
  'MikroORM',
  'Drizzle',
  'Drizzle (bunSql)',
  'Knex',
  'Kysely',
] as const;

export const FLOW_BASELINES = ['raw pg', 'bun sql'] as const;

export const FLOW_STEPS = ['insert', 'read', 'update', 'readAgain', 'nested', 'delete', 'readEmpty'] as const;

export type FlowEntry = (typeof FLOW_ENTRIES)[number];
export type FlowStep = (typeof FLOW_STEPS)[number];

/**
 * One measured column. `null` is a real value: Sequelize has no equivalent for the populate category,
 * and reporting a zero there would read as "slow" rather than "absent".
 */
export type Series = (number | null)[];

/**
 * A benchmark's shape, independent of what it measures. The two datasets disagree on almost everything:
 * units, which direction is better, how many entries, whether some entries are reference floors rather
 * than competitors. Every consumer reads those from here rather than assuming.
 */
export type Dataset = {
  readonly key: string;
  readonly label: string;
  readonly blurb: string;
  readonly unit: string;
  /** µs per operation for the flow, throughput for generation. Drives ranking, medals and bar scaling. */
  readonly lowerIsBetter: boolean;
  readonly entries: readonly string[];
  /** Hand-written references, ranked and drawn but excluded from "who won". */
  readonly baselines: readonly string[];
  readonly categories: readonly { key: string; label: string; readmeLabel: string; group: string }[];
  readonly data: Record<string, Series>;
};

/**
 * `benchMatch` is the distinctive tail of the `describe()` title in `compiler.bench.ts`, not the whole
 * string: the titles separate their two halves with an em dash, and depending on a specific dash
 * character to line up across two files is a needless way to break the mapping.
 */
const GENERATION_CATEGORIES = [
  {
    key: 'insert',
    label: 'INSERT: 10 rows in batch',
    readmeLabel: 'INSERT (10 rows)',
    group: 'write',
    benchMatch: 'batch (10 rows)',
  },
  {
    key: 'update',
    label: 'UPDATE: SET + WHERE',
    readmeLabel: 'UPDATE (SET+WHERE)',
    group: 'write',
    benchMatch: 'simple SET + WHERE',
  },
  {
    key: 'upsert',
    label: 'UPSERT: ON CONFLICT by id',
    readmeLabel: 'UPSERT (ON CONFLICT)',
    group: 'write',
    benchMatch: 'ON CONFLICT by id',
  },
  {
    key: 'delete',
    label: 'DELETE: simple WHERE',
    readmeLabel: 'DELETE (WHERE)',
    group: 'write',
    benchMatch: 'simple WHERE',
  },
  {
    key: 'simple',
    label: 'SELECT: 1 field',
    readmeLabel: 'SELECT (1 field)',
    group: 'read',
    benchMatch: 'simple (1 field, no WHERE)',
  },
  {
    key: 'filter',
    label: 'SELECT: WHERE + SORT + LIMIT',
    readmeLabel: 'SELECT (WHERE+SORT+LIMIT)',
    group: 'read',
    benchMatch: 'WHERE + SORT + LIMIT',
  },
  {
    key: 'complex',
    label: 'SELECT: complex $or + operators',
    readmeLabel: 'SELECT (complex $or)',
    group: 'read',
    benchMatch: 'complex $or + operators',
  },
  {
    key: 'populate',
    label: 'SELECT: populate (m:1 JOIN)',
    readmeLabel: 'SELECT (populate JOIN)',
    group: 'read',
    benchMatch: 'populate (m:1 JOIN)',
  },
  {
    key: 'aggregate',
    label: 'AGGREGATE: GROUP BY + COUNT + HAVING',
    readmeLabel: 'AGGREGATE (GROUP+HAVING)',
    group: 'read',
    benchMatch: 'GROUP BY + COUNT + HAVING',
  },
] as const;

export const GENERATION_ENTRIES = ['UQL', 'Sequelize', 'TypeORM', 'MikroORM', 'Drizzle', 'Knex', 'Kysely'] as const;

/** Which half of the lifecycle each flow step belongs to, for the grouped display. */
const FLOW_GROUPS: Record<string, string> = {
  insert: 'write',
  read: 'read',
  update: 'write',
  readAgain: 'read',
  nested: 'read',
  delete: 'write',
  readEmpty: 'read',
};

const FLOW_LABELS: Record<string, string> = {
  insert: 'INSERT: 10 rows, returning ids',
  read: 'SELECT: WHERE + SORT + LIMIT 200',
  update: 'UPDATE: by id',
  readAgain: 'SELECT: verify the update',
  nested: 'SELECT: 50 parents with their children',
  delete: 'DELETE: by id',
  readEmpty: 'SELECT: verify the delete',
};

export type VitestBenchJson = {
  files: Array<{
    filepath: string;
    groups: Array<{
      fullName: string;
      benchmarks: Array<{ name: string; hz: number }>;
    }>;
  }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Extraction
// ─────────────────────────────────────────────────────────────────────────────

/** K ops/sec per category, as `Math.round(hz / 1000)`. */
export function extractGeneration(vitestJson: VitestBenchJson): Record<string, Series> {
  const groups = vitestJson.files.flatMap((f) => f.groups);
  const out: Record<string, Series> = {};

  for (const category of GENERATION_CATEGORIES) {
    const matched = groups.filter((g) => g.fullName.includes(category.benchMatch));
    if (matched.length !== 1) {
      throw new TypeError(`Expected exactly 1 vitest group for "${category.key}", found ${matched.length}`);
    }

    const hzByEntry = new Map<string, number>();
    for (const b of matched[0].benchmarks) {
      // A failed case leaves `hz` absent or non-finite; keeping only real measurements means a missing
      // entry shows up as `n/a` rather than being averaged in as a zero.
      if (typeof b.hz === 'number' && Number.isFinite(b.hz)) hzByEntry.set(b.name, b.hz);
    }

    out[category.key] = GENERATION_ENTRIES.map((entry) => {
      const hz = hzByEntry.get(entry);
      // Absent by design in `populate`: Sequelize's `include` has no compile-only path to measure.
      return hz === undefined ? null : Math.round(hz / 1000);
    });
  }

  return out;
}

export function averageGeneration(runs: readonly VitestBenchJson[]): Record<string, Series> {
  const extracted = runs.map(extractGeneration);
  const out: Record<string, Series> = {};

  for (const category of GENERATION_CATEGORIES) {
    out[category.key] = GENERATION_ENTRIES.map((_, i) => {
      const values = extracted.map((d) => d[category.key][i]).filter((v): v is number => v !== null);
      // Absent in every run stays absent, rather than collapsing to 0.
      return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Datasets
// ─────────────────────────────────────────────────────────────────────────────

export function generationDataset(data: Record<string, Series>): Dataset {
  return {
    key: 'generation',
    label: 'SQL generation',
    blurb: 'Building the statement and its parameters, with no database involved.',
    unit: 'K ops/sec',
    lowerIsBetter: false,
    entries: [...GENERATION_ENTRIES],
    baselines: [],
    categories: GENERATION_CATEGORIES.map(({ key, label, readmeLabel, group }) => ({
      key,
      label,
      readmeLabel,
      group,
    })),
    data,
  };
}

export function flowDataset(data: Record<string, Series>): Dataset {
  return {
    key: 'flow',
    label: 'Database round trip',
    blurb: 'A full lifecycle against Postgres, including decoding rows back into objects.',
    unit: 'µs/op',
    lowerIsBetter: true,
    entries: [...FLOW_ENTRIES],
    baselines: [...FLOW_BASELINES],
    categories: FLOW_STEPS.map((step) => ({
      key: step,
      label: FLOW_LABELS[step] ?? step,
      readmeLabel: step,
      group: FLOW_GROUPS[step] ?? 'read',
    })),
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking
// ─────────────────────────────────────────────────────────────────────────────

/** The winning value in a series, honouring direction and ignoring absent entries. */
export function bestValue(values: Series, lowerIsBetter: boolean): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (!present.length) return null;
  return lowerIsBetter ? Math.min(...present) : Math.max(...present);
}

/** Total across every category, or `null` if any is absent, since a partial total is not comparable. */
export function totalOf(dataset: Dataset, entryIndex: number): number | null {
  let sum = 0;
  for (const category of dataset.categories) {
    const v = dataset.data[category.key]?.[entryIndex];
    if (v === null || v === undefined) return null;
    sum += v;
  }
  return sum;
}

export type Ranking = {
  entry: string;
  isBaseline: boolean;
  wins: number;
  /** Multiplier against the worst entry, in whichever category the entry does best. */
  best: number;
  total: number | null;
};

export function rank(dataset: Dataset): Ranking[] {
  const { entries, categories, data, lowerIsBetter } = dataset;

  const wins = entries.map(() => 0);
  for (const category of categories) {
    const values = data[category.key];
    // Baselines are hand-written driver code, so they are excluded before the best is picked rather than
    // after: they win nearly every round-trip step, and looking for a competitor that merely *ties* the
    // floor would leave every entry on zero.
    const contested = values.map((v, i) => (dataset.baselines.includes(entries[i]) ? null : v));
    const best = bestValue(contested, lowerIsBetter);
    if (best === null) continue;
    const winner = contested.indexOf(best);
    if (winner >= 0) wins[winner]++;
  }

  const rankings: Ranking[] = entries.map((entry, i) => {
    const ratios = categories
      .map((category) => {
        const values = data[category.key] ?? [];
        const own = values[i];
        if (own === null || own === undefined) return null;
        const present = values.filter((v): v is number => v !== null);
        const worst = lowerIsBetter ? Math.max(...present) : Math.min(...present);
        return lowerIsBetter ? worst / own : own / worst;
      })
      .filter((r): r is number => r !== null);

    return {
      entry,
      isBaseline: dataset.baselines.includes(entry),
      wins: wins[i],
      best: ratios.length ? Math.max(...ratios) : 1,
      total: totalOf(dataset, i),
    };
  });

  /** An absent total sorts last: it means the entry skipped a category, so it is not comparable. */
  const byTotal = (a: Ranking, b: Ranking) => {
    if (a.total === null) return 1;
    if (b.total === null) return -1;
    return lowerIsBetter ? a.total - b.total : b.total - a.total;
  };

  // Wins first, then total. Sorting by the `best` multiplier instead ranked an entry that led one
  // category by a wide margin above one that won five, which is not what a leaderboard means. Baselines
  // sit above the leaderboard rather than in it, since they are the floor being measured against.
  const baselines = rankings.filter((r) => r.isBaseline).sort(byTotal);
  const competitors = rankings.filter((r) => !r.isBaseline).sort((a, b) => b.wins - a.wins || byTotal(a, b));

  return [...baselines, ...competitors];
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts
// ─────────────────────────────────────────────────────────────────────────────

const ABSENT = 'n/a';

const ENTRY_URLS: Record<string, string> = {
  UQL: 'https://uql-orm.dev',
  Sequelize: 'https://sequelize.org',
  TypeORM: 'https://typeorm.io',
  MikroORM: 'https://mikro-orm.io',
  Drizzle: 'https://orm.drizzle.team',
  Knex: 'https://knexjs.org',
  Kysely: 'https://kysely.dev',
  'raw pg': 'https://node-postgres.com',
  'bun sql': 'https://bun.sh/docs/api/sql',
};

/** A driver variant links to the same project, since `Drizzle (bunSql)` is still Drizzle. */
function linkEntry(entry: string): string {
  const url = ENTRY_URLS[entry.replace(/\s*\(.+\)$/, '')];
  return url ? `[${entry}](${url})` : entry;
}

function formatValue(v: number | null, dataset: Dataset): string {
  if (v === null) return ABSENT;
  if (dataset.lowerIsBetter) return `${v}`;
  if (v >= 1000) {
    const thousands = Math.floor(v / 1000);
    const remainder = v % 1000;
    return remainder === 0 ? `${thousands},000K` : `${thousands},${String(remainder).padStart(3, '0')}K`;
  }
  return `${v}K`;
}

function generateResultsJs(datasets: readonly Dataset[]): string {
  const payload = {
    datasets: datasets.map((d) => ({
      key: d.key,
      label: d.label,
      blurb: d.blurb,
      unit: d.unit,
      lowerIsBetter: d.lowerIsBetter,
      entries: d.entries,
      baselines: d.baselines,
      categories: d.categories.map(({ key, label, group }) => ({ key, label, group })),
      data: d.data,
    })),
  };

  return [
    '// Auto-generated by scripts/update-results.ts: do not edit manually',
    `window.BENCH = ${JSON.stringify(payload, null, 2)};`,
    '',
  ].join('\n');
}

/**
 * Rewrites the region between `<!-- bench:<key> -->` and `<!-- /bench:<key> -->`.
 *
 * Markers rather than per-row regexes: the tables now differ in width and in which entries they list, so
 * matching a row by its label left every table with whatever column count it already had.
 */
function replaceMarked(markdown: string, key: string, body: string): string {
  const open = `<!-- bench:${key} -->`;
  const close = `<!-- /bench:${key} -->`;
  const start = markdown.indexOf(open);
  const end = markdown.indexOf(close);
  if (start < 0 || end < 0) {
    throw new TypeError(`README is missing the ${open} ... ${close} markers`);
  }
  return `${markdown.slice(0, start + open.length)}\n${body}\n${markdown.slice(end)}`;
}

function categoryTable(dataset: Dataset): string {
  const header = `| Operation | ${dataset.entries.map(linkEntry).join(' | ')} |`;
  const divider = `| --- | ${dataset.entries.map(() => '---').join(' | ')} |`;

  /**
   * The medal marks the best *competitor*, not the best number. A baseline is hand-written driver code
   * and wins nearly every round-trip step, so medalling it would contradict the win counts beside it and
   * leave every real entry reading `0/7`.
   */
  const medalRow = (values: Series): string[] => {
    const contested = values.map((v, i) => (dataset.baselines.includes(dataset.entries[i]) ? null : v));
    const best = bestValue(contested, dataset.lowerIsBetter);
    return values.map((v, i) => {
      const formatted = formatValue(v, dataset);
      const isBaseline = dataset.baselines.includes(dataset.entries[i]);
      return v !== null && v === best && !isBaseline ? `**${formatted}** 🥇` : formatted;
    });
  };

  const rows = dataset.categories.map(
    (category) => `| ${category.readmeLabel} | ${medalRow(dataset.data[category.key]).join(' | ')} |`,
  );

  const totals = dataset.entries.map((_, i) => totalOf(dataset, i));
  return [header, divider, ...rows, `| **Total** | ${medalRow(totals).join(' | ')} |`].join('\n');
}

function rankingTable(dataset: Dataset): string {
  const medals = ['🥇', '🥈', '🥉'];
  const rankings = rank(dataset);
  const competitors = rankings.filter((r) => !r.isBaseline);
  const total = dataset.categories.length;

  const rows = rankings.map((r) => {
    const place = competitors.indexOf(r) + 1;
    const position = r.isBaseline ? 'ref' : `${medals[place - 1] ?? ''} ${place}`.trim();
    const name = r.isBaseline ? `_${r.entry}_` : r.wins > 0 ? `**${r.entry}**` : r.entry;
    const wins = r.isBaseline ? 'ref' : r.wins > 0 ? `**${r.wins}/${total}** 🏆` : `0/${total}`;
    const totalCell = r.total === null ? ABSENT : formatValue(r.total, dataset);
    return `| ${position} | ${name} | ${wins} | ${totalCell} | ${r.best.toFixed(1)}x |`;
  });

  return [
    `| P | Entry | Wins | Total ${dataset.unit} | Widest lead |`,
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function updateReadme(readme: string, datasets: readonly Dataset[]): string {
  for (const dataset of datasets) {
    readme = replaceMarked(readme, dataset.key, categoryTable(dataset));
    readme = replaceMarked(readme, `${dataset.key}-ranking`, rankingTable(dataset));
  }

  const generation = datasets.find((d) => d.key === 'generation');
  if (generation) {
    const top = rank(generation)
      .filter((r) => !r.isBaseline)
      .sort((a, b) => b.wins - a.wins)[0];
    readme = readme.replace(
      /\*\*\w+ wins \d+ out of \d+\*\*/,
      `**${top.entry} wins ${top.wins} out of ${generation.categories.length}**`,
    );
  }

  return readme;
}

/**
 * Neither artifact is formatted afterwards. `results.js` is excluded from biome on purpose, because its
 * payload is strict JSON that `loadExistingDatasets` reads back and formatting it as JavaScript unquotes
 * the keys; biome does not handle markdown at all, so the README was never formatted either.
 */
export function syncResultsArtifacts(datasets: readonly Dataset[]): void {
  writeFileSync(resolve(root, 'results.js'), generateResultsJs(datasets));

  const readmePath = resolve(root, 'README.md');
  writeFileSync(readmePath, updateReadme(readFileSync(readmePath, 'utf8'), datasets));
}

const BUILDERS: Record<string, (data: Record<string, Series>) => Dataset> = {
  generation: generationDataset,
  flow: flowDataset,
};

/**
 * The datasets currently on disk, so re-running one bench never drops the other's numbers.
 *
 * Only `data` is taken from the file; every label, unit and flag is rebuilt from the definitions above.
 * Editing a label therefore reaches both artifacts on the next run of either bench, and the persisted
 * payload does not have to carry fields the page never reads.
 */
export function loadExistingDatasets(): Dataset[] {
  const path = resolve(root, 'results.js');
  if (!existsSync(path)) return [];

  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < 0) return [];

  let parsed: { datasets?: { key: string; data: Record<string, Series> }[] };
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch {
    // A file from before the payload became strict JSON. Its numbers are stale anyway, and the bench that
    // is running is about to write its own dataset.
    console.warn('results.js is not in the current format, starting from an empty set');
    return [];
  }

  return (parsed.datasets ?? []).filter((d) => d.key in BUILDERS).map((d) => BUILDERS[d.key](d.data));
}

/** Replaces `dataset` among what is already on disk, in the order `BUILDERS` declares. */
export function mergeDataset(dataset: Dataset): Dataset[] {
  const order = Object.keys(BUILDERS);
  const kept = loadExistingDatasets().filter((d) => d.key !== dataset.key);
  return [...kept, dataset].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function printSummary(dataset: Dataset): void {
  console.log(`\n${dataset.label} (${dataset.unit}):`);
  for (const category of dataset.categories) {
    const cells = dataset.entries
      .map((entry, i) => `${entry}: ${formatValue(dataset.data[category.key][i], dataset)}`)
      .join('  ');
    console.log(`  ${category.key}: ${cells}`);
  }
}
