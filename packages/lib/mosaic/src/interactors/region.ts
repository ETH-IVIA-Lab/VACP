import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';

function normalizePointValue(raw: unknown): unknown[][] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw) && raw.length === 0) return null;
  if (Array.isArray(raw) && Array.isArray(raw[0])) return raw as unknown[][];
  if (Array.isArray(raw)) return (raw as unknown[]).map((v) => [v]);
  return [[raw]];
}

/**
 * Programmatic control of vgplot Region interactors.
 *
 * Region interactors select marks by "key" (for example `id` or `z`),
 * typically via clicking or lassoing regions.
 */
export async function executeRegionAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';
  if (ctorName !== 'Region') throw new Error(`Expected Region interactor, got ${ctorName}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = interactor as any;
  if (typeof anyI.selection?.update !== 'function' || typeof anyI.clause !== 'function') {
    throw new Error('Region interactor is missing selection.update/clause');
  }

  if (call.name === 'mosaic.clear_region') {
    anyI.value = null;
    anyI.selection.update(anyI.clause(null));
    return { cleared: true };
  }

  if (call.name === 'mosaic.set_region') {
    const value = normalizePointValue(params.value);
    anyI.value = value;
    anyI.selection.update(anyI.clause(value));
    return { set: true };
  }

  throw new Error(`Unsupported region action: ${call.name}`);
}

