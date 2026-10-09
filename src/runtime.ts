/**
 * Which JS runtime is executing, so the report names the one that produced the numbers and the Bun-only
 * entries are dropped instead of crashing the run.
 */

/** Bun first: it is the only runtime that can run every entry, so its ranking orders the runtime table. */
export const RUNTIME_NAMES = ['bun', 'node'] as const;

export type RuntimeName = (typeof RUNTIME_NAMES)[number];

export type Runtime = { name: RuntimeName; version: string; label: string };

export const RUNTIME_LABELS: Record<RuntimeName, string> = { bun: 'Bun', node: 'Node' };

/** `process.versions` rather than a global: Bun adds its own key there next to Node's. */
function detect(): Omit<Runtime, 'label'> {
  const { bun, node } = process.versions;
  return bun ? { name: 'bun', version: bun } : { name: 'node', version: node };
}

const detected = detect();

export const RUNTIME: Runtime = {
  ...detected,
  label: `${RUNTIME_LABELS[detected.name]} ${detected.version}`,
};
