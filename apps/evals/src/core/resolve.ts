import type { VacpGraph } from '@vacp/protocol';

import type { Act } from './scenario';

/**
 * The live, source-qualified action a scenario's local name or contract names. When several sources
 * offer it, the action whose source owns the `ref` parameter wins. Anything but one match throws.
 */
export function resolveAction(graph: Pick<VacpGraph, 'actions' | 'ownership'>, act: Act): string {
  if (graph.actions.some((action) => action.name === act.action)) return act.action;
  let candidates = graph.actions.filter(
    (action) => action.name.endsWith(`.${act.action}`) || action.operation?.contract === act.action,
  );
  const ref = (act.params as { ref?: unknown } | undefined)?.ref;
  if (candidates.length > 1 && typeof ref === 'string') {
    const owner = graph.ownership.nodes[ref as keyof typeof graph.ownership.nodes];
    candidates = candidates.filter((action) => graph.ownership.actions[action.name] === owner);
  }
  if (candidates.length !== 1)
    throw new Error(
      `Action "${act.action}" matches ${candidates.length} live actions: ${candidates.map((a) => a.name).join(', ') || 'none'}`,
    );
  return candidates[0]!.name;
}
