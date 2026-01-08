import type { VacpRef } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { executeInputAction } from './inputs';
import { executeIntervalAction } from './interactors/interval';
import { executeNearestAction } from './interactors/nearest';
import { executePanZoomAction } from './interactors/pan-zoom';
import { executeRegionAction } from './interactors/region';
import { executeToggleAction } from './interactors/toggle';
import type { VgplotPlotLike } from './types';

export function makeApplyStateHandler(args: {
  inputByRef: Map<VacpRef, CollectedInput>;
  plotsById: Map<string, VgplotPlotLike>;
}) {
  const { inputByRef, plotsById } = args;

  return async (state: Record<string, unknown>) => {
    const errors: Array<{ ref: string; message: string }> = [];
    let applied = 0;

    for (const [ref, raw] of Object.entries(state)) {
      const key = ref as VacpRef;
      const input = inputByRef.get(key);
      if (input) {
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const desired = (rec.value ?? raw) as unknown;
        try {
          if (desired === null || desired === undefined) {
            await executeInputAction(input, { name: 'mosaic.clear_input', params: { ref } });
          } else if (typeof rec.optionIndex === 'number') {
            await executeInputAction(input, {
              name: 'mosaic.set_input_option_index',
              params: { ref, index: rec.optionIndex },
            });
          } else {
            await executeInputAction(input, { name: 'mosaic.set_input_value', params: { ref, value: desired } });
          }
          applied += 1;
        } catch (err) {
          errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
        }
        continue;
      }

      const idx = ref.lastIndexOf('/interactor/');
      if (idx < 0) continue;
      const plotSeg = ref.slice(0, idx);
      const plotId = plotSeg.split('/').pop() ?? '';
      const plot = plotsById.get(plotId);
      if (!plot) {
        errors.push({ ref, message: `Unknown plotId in ref: ${plotId}` });
        continue;
      }
      const interactorId = ref.slice(idx + '/interactor/'.length);
      const interactor = plot.interactors[Number(interactorId)];
      if (!interactor) {
        errors.push({ ref, message: `Unknown interactorId: ${interactorId}` });
        continue;
      }

      const ctorName = interactor.constructor?.name ?? 'Interactor';
      const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const desired = (rec.value ?? rec.selectionValue ?? raw) as unknown;
      const callId = crypto.randomUUID();

      try {
        if (desired === null || desired === undefined) {
          if (ctorName === 'Interval1D')
            await executeIntervalAction(plot, {
              callId,
              name: 'mosaic.clear_interval_1d',
              params: { plotId, interactorId },
            });
          else if (ctorName === 'Interval2D')
            await executeIntervalAction(plot, {
              callId,
              name: 'mosaic.clear_interval_2d',
              params: { plotId, interactorId },
            });
          else if (ctorName === 'PanZoom')
            await executePanZoomAction(plot, { callId, name: 'mosaic.clear_pan_zoom', params: { plotId, interactorId } });
          else if (ctorName === 'Nearest')
            await executeNearestAction(plot, { callId, name: 'mosaic.clear_nearest', params: { plotId, interactorId } });
          else if (ctorName === 'Toggle')
            await executeToggleAction(plot, { callId, name: 'mosaic.clear_toggle', params: { plotId, interactorId } });
          else if (ctorName === 'Region')
            await executeRegionAction(plot, { callId, name: 'mosaic.clear_region', params: { plotId, interactorId } });
          else errors.push({ ref, message: `Unsupported interactor kind for clear: ${ctorName}` });
          applied += 1;
          continue;
        }

        if (ctorName === 'Interval1D') {
          const val = Array.isArray(desired) ? desired : [rec.min, rec.max];
          const min = Number((val as unknown[])[0]);
          const max = Number((val as unknown[])[1]);
          if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('Expected [min, max] numbers');
          await executeIntervalAction(plot, {
            callId,
            name: 'mosaic.set_interval_1d',
            params: { plotId, interactorId, min, max },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Interval2D') {
          const arr = desired as unknown;
          const xPair = Array.isArray(arr) && Array.isArray((arr as unknown[])[0]) ? (arr as unknown[][])[0] : null;
          const yPair = Array.isArray(arr) && Array.isArray((arr as unknown[])[1]) ? (arr as unknown[][])[1] : null;
          const x0 = Number(xPair?.[0]);
          const x1 = Number(xPair?.[1]);
          const y0 = Number(yPair?.[0]);
          const y1 = Number(yPair?.[1]);
          if (![x0, x1, y0, y1].every(Number.isFinite)) throw new Error('Expected [[x0,x1],[y0,y1]] numbers');
          await executeIntervalAction(plot, {
            callId,
            name: 'mosaic.set_interval_2d',
            params: { plotId, interactorId, x0, x1, y0, y1 },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'PanZoom') {
          const x = (rec.x ?? null) as unknown;
          const y = (rec.y ?? null) as unknown;
          const hasX = Array.isArray(x) && x.length >= 2;
          const hasY = Array.isArray(y) && y.length >= 2;
          if (!hasX && !hasY) throw new Error('Expected {x:[x0,x1]} and/or {y:[y0,y1]}');
          const x0 = hasX ? Number((x as unknown[])[0]) : undefined;
          const x1 = hasX ? Number((x as unknown[])[1]) : undefined;
          const y0 = hasY ? Number((y as unknown[])[0]) : undefined;
          const y1 = hasY ? Number((y as unknown[])[1]) : undefined;
          await executePanZoomAction(plot, {
            callId,
            name: 'mosaic.set_pan_zoom',
            params: { plotId, interactorId, x0, x1, y0, y1 },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Nearest') {
          await executeNearestAction(plot, {
            callId,
            name: 'mosaic.set_nearest',
            params: { plotId, interactorId, value: desired },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Toggle') {
          await executeToggleAction(plot, {
            callId,
            name: 'mosaic.set_toggle',
            params: { plotId, interactorId, value: desired },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Region') {
          await executeRegionAction(plot, {
            callId,
            name: 'mosaic.set_region',
            params: { plotId, interactorId, value: desired },
          });
          applied += 1;
          continue;
        }

        errors.push({ ref, message: `Unsupported interactor kind: ${ctorName}` });
      } catch (err) {
        errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return { applied, errors };
  };
}
