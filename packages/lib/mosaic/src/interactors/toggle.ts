import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';

export async function executeToggleAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);
  const ctorName = interactor.constructor?.name ?? 'Interactor';
  if (ctorName !== 'Toggle') throw new Error(`Expected Toggle interactor, got ${ctorName}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = interactor as any;
  if (call.name === 'mosaic.clear_toggle') {
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.value = null;
      anyI.selection.update(anyI.clause(null));
      return { cleared: true };
    }
    anyI.value = null;
    return { cleared: true, warning: 'toggle selection.update/clause not available' };
  }

  if (call.name === 'mosaic.set_toggle') {
    const raw = params.value;
    const points =
      Array.isArray(raw) && Array.isArray((raw as unknown[])[0])
        ? (raw as unknown[][])
        : raw === null || raw === undefined
          ? null
          : [[raw]];
    anyI.value = points;
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(points));
      return { set: true };
    }
    return { set: true, warning: 'toggle selection.update/clause not available' };
  }

  throw new Error(`Unsupported Toggle action: ${call.name}`);
}
