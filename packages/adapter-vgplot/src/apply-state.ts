import type { VacpRef } from '@vacp/protocol';
import { lastPathComponent, splitVacpRefAt } from '@vacp/protocol';

import type { CollectedInput } from './inputs';
import { executeInputAction } from './inputs';
import { executeIntervalAction } from './interactors/interval';
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

function hasDomainPair(value: unknown): value is [unknown, unknown] {
  return Array.isArray(value) && value.length >= 2;
}

function hasPanZoomDomain(record: Record<string, unknown>): boolean {
  return hasDomainPair(record.x) || hasDomainPair(record.y);
}

export function makeApplyStateHandler(args: {
  inputByRef: Map<VacpRef, CollectedInput>;
  plotsById: Map<string, VgplotPlotLike>;
  tablesById?: Map<string, VgplotTableLike>;
}) {
  const { inputByRef, plotsById, tablesById } = args;

  return async (state: Record<string, unknown>) => {
    const errors: Array<{ ref: string; message: string }> = [];
    const skipped: Array<{ ref: string; reason: string }> = [];
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
              name: 'vgplot.set_input_option_index',
              params: { ref, index: rec.optionIndex },
            });
          } else if (desired === null || desired === undefined) {
            await executeInputAction(input, { name: 'vgplot.clear_input', params: { ref } });
          } else {
            await executeInputAction(input, { name: 'vgplot.set_input_value', params: { ref, value: desired } });
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
          let tableApplied = false;

          if (typeof sortColumn === 'string' && sortColumn) {
            await executeTableAction(table, {
              name: 'vgplot.table_set_sort',
              params: { column: sortColumn, desc: sortDesc },
            });
            tableApplied = true;
          } else if (sortColumn === null || sortColumn === undefined) {
            await executeTableAction(table, { name: 'vgplot.table_clear_sort' });
            tableApplied = true;
          }

          if (typeof rec.offset === 'number' || typeof rec.limit === 'number') {
            await executeTableAction(table, {
              name: 'vgplot.table_set_page',
              params: { offset: rec.offset, limit: rec.limit },
            });
            tableApplied = true;
          }

          if (tableApplied) applied += 1;
          else skipped.push({ ref, reason: 'Table state did not include supported sort or pagination fields' });
        } catch (err) {
          errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
        }

        continue;
      }

      const parsed = splitVacpRefAt(ref, '/interactor/');

      if (!parsed) {
        const kind = isRecord(raw) && typeof raw.kind === 'string' ? raw.kind : 'unknown';
        skipped.push({
          ref,
          reason:
            kind === 'DataHandle'
              ? 'DataHandle refs are read-only and are controlled by plot, table, or widget state'
              : `Ref kind ${kind} is not controllable by VGPlot apply_state`,
        });
        continue;
      }

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
      let desired: unknown = raw;

      if (rec) {
        if (ctorName === 'Nearest' && Object.hasOwn(rec, 'value')) desired = rec.value;
        else if (ctorName === 'PanZoom' && hasPanZoomDomain(rec)) desired = rec;
        else if (rec.selectionValue !== undefined) desired = rec.selectionValue;
        else if (Object.hasOwn(rec, 'value')) desired = rec.value;
        else desired = undefined;
      }

      const callId = crypto.randomUUID();

      try {
        if (desired === null || desired === undefined) {
          if (ctorName === 'Interval1D')
            await executeIntervalAction(plot, {
              callId,
              name: 'vgplot.clear_interval_1d',
              params: { plotId, interactorId },
            });
          else if (ctorName === 'Interval2D')
            await executeIntervalAction(plot, {
              callId,
              name: 'vgplot.clear_interval_2d',
              params: { plotId, interactorId },
            });
          else if (ctorName === 'PanZoom')
            await executePanZoomAction(plot, {
              callId,
              name: 'vgplot.clear_pan_zoom',
              params: { plotId, interactorId },
            });
          else if (ctorName === 'Nearest') {
            skipped.push({
              ref,
              reason:
                'Nearest refs are transient hover state and cannot be replayed safely without VGPlot pointer-derived values',
            });
            continue;
          } else if (ctorName === 'Toggle')
            await executeToggleAction(plot, { callId, name: 'vgplot.clear_toggle', params: { plotId, interactorId } });
          else if (ctorName === 'Region')
            await executeRegionAction(plot, { callId, name: 'vgplot.clear_region', params: { plotId, interactorId } });
          else {
            errors.push({ ref, message: `Unsupported interactor kind for clear: ${ctorName}` });
            continue;
          }

          applied += 1;
          continue;
        }

        if (ctorName === 'Interval1D') {
          const val = Array.isArray(desired)
            ? desired
            : rec && (Object.hasOwn(rec, 'min') || Object.hasOwn(rec, 'max'))
              ? [rec.min, rec.max]
              : null;

          const min = coerceDomainValue(val?.[0]);
          const max = coerceDomainValue(val?.[1]);

          if (min === null || max === null) throw new Error('Expected [min, max] domain values');
          await executeIntervalAction(plot, {
            callId,
            name: 'vgplot.set_interval_1d',
            params: { plotId, interactorId, min, max },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Interval2D') {
          const arr = desired;
          const xPair = Array.isArray(arr) && Array.isArray(arr[0]) ? arr[0] : null;
          const yPair = Array.isArray(arr) && Array.isArray(arr[1]) ? arr[1] : null;
          const x0 = coerceDomainValue(xPair?.[0]);
          const x1 = coerceDomainValue(xPair?.[1]);
          const y0 = coerceDomainValue(yPair?.[0]);
          const y1 = coerceDomainValue(yPair?.[1]);

          if ([x0, x1, y0, y1].some((v) => v === null)) throw new Error('Expected [[x0,x1],[y0,y1]] domain values');
          await executeIntervalAction(plot, {
            callId,
            name: 'vgplot.set_interval_2d',
            params: { plotId, interactorId, x0, x1, y0, y1 },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'PanZoom') {
          const x = rec?.x ?? null;
          const y = rec?.y ?? null;
          const hasX = hasDomainPair(x);
          const hasY = hasDomainPair(y);

          if (!hasX && !hasY) throw new Error('Expected {x:[x0,x1]} and/or {y:[y0,y1]}');
          const x0 = hasX ? (coerceDomainValue(x[0]) ?? undefined) : undefined;
          const x1 = hasX ? (coerceDomainValue(x[1]) ?? undefined) : undefined;
          const y0 = hasY ? (coerceDomainValue(y[0]) ?? undefined) : undefined;
          const y1 = hasY ? (coerceDomainValue(y[1]) ?? undefined) : undefined;
          await executePanZoomAction(plot, {
            callId,
            name: 'vgplot.set_pan_zoom',
            params: { plotId, interactorId, x0, x1, y0, y1 },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Nearest') {
          skipped.push({
            ref,
            reason:
              'Nearest refs are transient hover state and cannot be replayed safely without VGPlot pointer-derived values',
          });
          continue;
        }

        if (ctorName === 'Toggle') {
          await executeToggleAction(plot, {
            callId,
            name: 'vgplot.set_toggle',
            params: { plotId, interactorId, value: desired },
          });
          applied += 1;
          continue;
        }

        if (ctorName === 'Region') {
          await executeRegionAction(plot, {
            callId,
            name: 'vgplot.set_region',
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

    return { applied, skipped, errors };
  };
}
