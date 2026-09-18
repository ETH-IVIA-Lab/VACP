import type { VacpActionCall } from '@vacp/protocol';

import type { VgplotPlotLike, VgplotInteractorLike } from '../types.js';
import { awaitPlotUpdate } from './plot-update.js';

type SelectionBackedNearest = VgplotInteractorLike & {
  selection: { update(value: unknown): unknown; predicate(...args: unknown[]): unknown };
  clause(value: unknown): unknown;
};

export function isSelectionBackedNearest(interactor: VgplotInteractorLike): interactor is SelectionBackedNearest {
  if (!interactor || typeof interactor !== 'object') return false;

  const candidate = interactor;

  return (
    candidate.constructor?.name === 'Nearest' &&
    typeof candidate.selection?.predicate === 'function' &&
    typeof candidate.selection.update === 'function' &&
    typeof candidate.clause === 'function'
  );
}

/**
 * Programmatic control of selection-backed vgplot Nearest interactors.
 *
 * Param-backed Nearest interactors receive raw scalar values from pointer
 * events. Sending a selection clause into those params corrupts downstream SQL
 * expressions, so they stay outside the semantic action surface.
 */
export async function executeNearestAction(plot: VgplotPlotLike, call: VacpActionCall) {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];

  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';

  if (ctorName !== 'Nearest') throw new Error(`Expected Nearest interactor, got ${ctorName}`);

  if (!isSelectionBackedNearest(interactor)) {
    throw new Error('Nearest interactor is param-backed and cannot be controlled through semantic actions');
  }

  const anyI = interactor;

  if (call.name === 'vgplot.clear_nearest') {
    anyI.value = null;
    anyI.selection.update(anyI.clause(null));
    await awaitPlotUpdate(plot);

    return { cleared: true };
  }

  throw new Error(`Unsupported nearest action: ${call.name}`);
}
