/**
 * Which JS runtime is executing, so the report names the one that produced the numbers and the Bun-only
 * entries are dropped instead of crashing the run.
 */

export type RuntimeName = 'bun' | 'node' | 'deno';

export type Runtime = { name: RuntimeName; version: string; label: string };

export const RUNTIME_LABELS: Record<RuntimeName, string> = { bun: 'Bun', node: 'Node', deno: 'Deno' };

/** `process.versions` rather than a global: all three runtimes populate their own key there. */
function detect(): Omit<Runtime, 'label'> {
  const { bun, deno, node } = process.versions;
  if (bun) {
    return { name: 'bun', version: bun };
  }
  if (deno) {
    return { name: 'deno', version: deno };
  }
  return { name: 'node', version: node };
}

const detected = detect();

export const RUNTIME: Runtime = {
  ...detected,
  label: `${RUNTIME_LABELS[detected.name]} ${detected.version}`,
};
