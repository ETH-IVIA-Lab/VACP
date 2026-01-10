import type { VacpRef } from '@vacp/core';
import { lastPathComponent, splitVacpRefAt } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { executeInputAction } from './inputs';
import { executeIntervalAction } from './interactors/interval';
import { executeNearestAction } from './interactors/nearest';
import { executePanZoomAction } from './interactors/pan-zoom';
import { executeRegionAction } from './interactors/region';
import { executeToggleAction } from './interactors/toggle';
import { executeTableAction } from './table-actions';
import type { VgplotPlotLike, VgplotTableLike } from './types';

type DomainValueLike = number | string | Date;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceDomainValue(value: unknown): DomainValueLike | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : null;
  }
  return null;
}

export function makeApplyStateHandler(args: {
  inputByRef: Map<VacpRef, CollectedInput>;
  plotsById: Map<string, VgplotPlotLike>;
  tablesById?: Map<string, VgplotTableLike>;
}) {
  const { inputByRef, plotsById, tablesById } = args;

  return async (state: Record<string, unknown>) => {
    const errors: Array<{ ref: string; message: string }> = [];
    let applied = 0;

    for (const [ref, raw] of Object.entries(state)) {
      const key = ref as VacpRef;
      const input = inputByRef.get(key);
      if (input) {
        const rec = isRecord(raw) ? raw : null;
        const desired = rec ? (Object.hasOwn(rec, 'value') ? rec.value : rec.selectionValue) : raw;
        try {
          if (typeof rec?.optionIndex === 'number') {
            await executeInputAction(input, {
              name: 'mosaic.set_input_option_index',
              params: { ref, index: rec.optionIndex },
            });
          } else if (desired === null || desired === undefined) {
            await executeInputAction(input, { name: 'mosaic.clear_input', params: { ref } });
          } else {
            await executeInputAction(input, { name: 'mosaic.set_input_value', params: { ref, value: desired } });
          }
          applied += 1;
        } catch (err) {
          errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
        }
        continue;
      }

      const tail = lastPathComponent(ref) ?? '';
      const table = tablesById?.get(tail);
      if (table) {
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        try {
          const sortColumn = rec.sortColumn ?? null;
          const sortDesc = Boolean(rec.sortDesc);
          if (typeof sortColumn === 'string' && sortColumn) {
            await executeTableAction(table, { name: 'mosaic.table_set_sort', params: { column: sortColumn, desc: sortDesc } });
          } else if (sortColumn === null || sortColumn === undefined) {
            await executeTableAction(table, { name: 'mosaic.table_clear_sort' });
          }
          if (typeof rec.offset === 'number' || typeof rec.limit === 'number') {
            await executeTableAction(table, { name: 'mosaic.table_set_page', params: { offset: rec.offset, limit: rec.limit } });
          }
          applied += 1;
        } catch (err) {
          errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
        }
        continue;
      }

      const parsed = splitVacpRefAt(ref, '/interactor/');
      if (!parsed) continue;
      const plotId = lastPathComponent(parsed.before) ?? '';
      const plot = plotsById.get(plotId);
      if (!plot) {
        errors.push({ ref, message: `Unknown plotId in ref: ${plotId}` });
        continue;
      }
      const interactorId = parsed.after;
      const interactor = plot.interactors[Number(interactorId)];
      if (!interactor) {
        errors.push({ ref, message: `Unknown interactorId: ${interactorId}` });
        continue;
      }

      const ctorName = interactor.constructor?.name ?? 'Interactor';
      const rec = isRecord(raw) ? raw : null;
      const desired = rec
        ? rec.selectionValue !== undefined
          ? rec.selectionValue
          : Object.hasOwn(rec, 'value')
            ? rec.value
            : undefined
        : raw;
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
          const val = Array.isArray(desired)
            ? desired
            : rec && (Object.hasOwn(rec, 'min') || Object.hasOwn(rec, 'max'))
              ? [rec.min, rec.max]
              : null;
          const min = coerceDomainValue((val as unknown[] | null)?.[0]);
          const max = coerceDomainValue((val as unknown[] | null)?.[1]);
          if (min === null || max === null) throw new Error('Expected [min, max] domain values');
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
          const x0 = coerceDomainValue(xPair?.[0]);
          const x1 = coerceDomainValue(xPair?.[1]);
          const y0 = coerceDomainValue(yPair?.[0]);
          const y1 = coerceDomainValue(yPair?.[1]);
          if ([x0, x1, y0, y1].some((v) => v === null)) throw new Error('Expected [[x0,x1],[y0,y1]] domain values');
          await executeIntervalAction(plot, {
            callId,
            name: 'mosaic.set_interval_2d',
            params: { plotId, interactorId, x0, x1, y0, y1 },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'PanZoom') {
          const x = (rec?.x ?? null) as unknown;
          const y = (rec?.y ?? null) as unknown;
          const hasX = Array.isArray(x) && x.length >= 2;
          const hasY = Array.isArray(y) && y.length >= 2;
          if (!hasX && !hasY) throw new Error('Expected {x:[x0,x1]} and/or {y:[y0,y1]}');
          const x0 = hasX ? (coerceDomainValue((x as unknown[])[0]) ?? undefined) : undefined;
          const x1 = hasX ? (coerceDomainValue((x as unknown[])[1]) ?? undefined) : undefined;
          const y0 = hasY ? (coerceDomainValue((y as unknown[])[0]) ?? undefined) : undefined;
          const y1 = hasY ? (coerceDomainValue((y as unknown[])[1]) ?? undefined) : undefined;
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
