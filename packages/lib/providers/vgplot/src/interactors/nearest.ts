import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';
import { awaitPlotUpdate } from './plot-update';

export function isSelectionBackedNearest(interactor: unknown): boolean {
  if (!interactor || typeof interactor !== 'object') return false;
  const candidate = interactor as {
    constructor?: { name?: string };
    selection?: { predicate?: unknown; update?: unknown };
    clause?: unknown;
  };
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
export async function executeNearestAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';
  if (ctorName !== 'Nearest') throw new Error(`Expected Nearest interactor, got ${ctorName}`);
  if (!isSelectionBackedNearest(interactor)) {
    throw new Error('Nearest interactor is param-backed and cannot be controlled through semantic actions');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = interactor as any;

  if (call.name === 'vgplot.clear_nearest') {
    anyI.value = null;
    anyI.selection.update(anyI.clause(null));
    await awaitPlotUpdate(plot);
    return { cleared: true };
  }

  throw new Error(`Unsupported nearest action: ${call.name}`);
}
