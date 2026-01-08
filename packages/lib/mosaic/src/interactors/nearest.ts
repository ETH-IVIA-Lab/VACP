import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';

function normalizeNearestValue(raw: unknown): unknown[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw as unknown[];
  return [raw];
}

/**
 * Programmatic control of vgplot Nearest interactors.
 *
 * Nearest interactors are often driven by hover/pointer events. For VACP we
 * expose a best-effort way to set/clear the underlying selection, enabling
 * agent-driven "inspect this series/point" behaviors without pixel automation.
 */
export async function executeNearestAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';
  if (ctorName !== 'Nearest') throw new Error(`Expected Nearest interactor, got ${ctorName}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = interactor as any;
  if (typeof anyI.selection?.update !== 'function' || typeof anyI.clause !== 'function') {
    throw new Error('Nearest interactor is missing selection.update/clause');
  }

  if (call.name === 'mosaic.clear_nearest') {
    anyI.value = null;
    anyI.selection.update(anyI.clause(null));
    return { cleared: true };
  }

  if (call.name === 'mosaic.set_nearest') {
    const value = normalizeNearestValue(params.value);
    anyI.value = value;
    anyI.selection.update(anyI.clause(value));
    return { set: true };
  }

  throw new Error(`Unsupported nearest action: ${call.name}`);
}

