import type { CollectedInput } from './inputs';
import { executeInputAction } from './inputs';
import { executeIntervalAction } from './interactors/interval';
import { executeLegendToggleAction } from './interactors/legend-toggle';
import { executeNearestAction } from './interactors/nearest';
import { executePanZoomAction } from './interactors/pan-zoom';
import { executeRegionAction } from './interactors/region';
import { executeToggleAction } from './interactors/toggle';
import { executeTableAction } from './table-actions';
import type { VgplotPlotLike, VgplotTableLike } from './types';

type RegisterFn = (name: string, handler: (params: unknown) => unknown | Promise<unknown>) => void;

export function registerMosaicDashboardActions(args: {
  register: RegisterFn;
  resolvePlot: (params: Record<string, unknown>) => { plotId: string; plot: VgplotPlotLike };
  resolveTable: (params: Record<string, unknown>) => { tableId: string; table: VgplotTableLike };
  resolveInput: (params: Record<string, unknown>) => CollectedInput;
}): void {
  const { register, resolvePlot, resolveTable, resolveInput } = args;

  register('mosaic.set_interval_1d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_interval_1d', params: p });
  });
  register('mosaic.clear_interval_1d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_interval_1d', params: p });
  });
  register('mosaic.set_interval_2d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_interval_2d', params: p });
  });
  register('mosaic.clear_interval_2d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_interval_2d', params: p });
  });

  register('mosaic.set_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeToggleAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_toggle', params: p });
  });
  register('mosaic.clear_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeToggleAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_toggle', params: p });
  });

  register('mosaic.set_legend_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeLegendToggleAction(plot, {
      callId: crypto.randomUUID(),
      name: 'mosaic.set_legend_toggle',
      params: p,
    });
  });
  register('mosaic.clear_legend_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeLegendToggleAction(plot, {
      callId: crypto.randomUUID(),
      name: 'mosaic.clear_legend_toggle',
      params: p,
    });
  });

  register('mosaic.set_nearest', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeNearestAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_nearest', params: p });
  });
  register('mosaic.clear_nearest', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeNearestAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_nearest', params: p });
  });

  register('mosaic.set_region', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeRegionAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_region', params: p });
  });
  register('mosaic.clear_region', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeRegionAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_region', params: p });
  });

  register('mosaic.set_pan_zoom', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executePanZoomAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.set_pan_zoom', params: p });
  });
  register('mosaic.clear_pan_zoom', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executePanZoomAction(plot, { callId: crypto.randomUUID(), name: 'mosaic.clear_pan_zoom', params: p });
  });

  register('mosaic.set_input_option_index', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'mosaic.set_input_option_index', params }),
  );
  register('mosaic.set_input_value', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'mosaic.set_input_value', params }),
  );
  register('mosaic.clear_input', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'mosaic.clear_input', params }),
  );

  register('mosaic.table_set_sort', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { table } = resolveTable(p);
    return await executeTableAction(table, { name: 'mosaic.table_set_sort', params: p });
  });
  register('mosaic.table_clear_sort', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { table } = resolveTable(p);
    return await executeTableAction(table, { name: 'mosaic.table_clear_sort', params: p });
  });
  register('mosaic.table_set_page', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { table } = resolveTable(p);
    return await executeTableAction(table, { name: 'mosaic.table_set_page', params: p });
  });
}
