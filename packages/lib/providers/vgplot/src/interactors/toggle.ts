import type { VacpActionCall } from '@vacp/core';

import type { VgplotPlotLike } from '../types';
import { awaitPlotUpdate } from './plot-update';

function isSqlLiteralLike(value: unknown): boolean {
  return (
    value == null ||
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function assertTogglePoints(points: unknown[][] | null): void {
  if (!points) return;
  for (const row of points) {
    if (!Array.isArray(row)) throw new Error('Expected toggle points to be an array of arrays');
    for (const v of row) {
      if (!isSqlLiteralLike(v)) {
        throw new Error(`Unsupported toggle value type: ${Object.prototype.toString.call(v)}`);
      }
    }
  }
}

export async function executeToggleAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);
  const ctorName = interactor.constructor?.name ?? 'Interactor';
  if (ctorName !== 'Toggle') throw new Error(`Expected Toggle interactor, got ${ctorName}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyI = interactor as any;
  if (call.name === 'vgplot.clear_toggle') {
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.value = null;
      anyI.selection.update(anyI.clause(null));
      await awaitPlotUpdate(plot);
      return { cleared: true };
    }
    anyI.value = null;
    await awaitPlotUpdate(plot);
    return { cleared: true, warning: 'toggle selection.update/clause not available' };
  }

  if (call.name === 'vgplot.set_toggle') {
    const raw = params.value;
    const points =
      raw === null || raw === undefined
        ? null
        : Array.isArray(raw) && raw.length === 0
          ? null
          : Array.isArray(raw) && Array.isArray((raw as unknown[])[0])
            ? (raw as unknown[][])
            : Array.isArray(raw)
              ? (raw as unknown[]).map((v) => [v])
              : [[raw]];
    assertTogglePoints(points);
    anyI.value = points;
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(points));
      await awaitPlotUpdate(plot);
      return { set: true };
    }
    await awaitPlotUpdate(plot);
    return { set: true, warning: 'toggle selection.update/clause not available' };
  }

  throw new Error(`Unsupported Toggle action: ${call.name}`);
}
