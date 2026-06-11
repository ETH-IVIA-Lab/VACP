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

export function registerVgplotDashboardActions(args: {
  register: RegisterFn;
  resolvePlot: (params: Record<string, unknown>) => { plotId: string; plot: VgplotPlotLike };
  resolveTable: (params: Record<string, unknown>) => { tableId: string; table: VgplotTableLike };
  resolveInput: (params: Record<string, unknown>) => CollectedInput;
}): void {
  const { register, resolvePlot, resolveTable, resolveInput } = args;

  register('vgplot.set_interval_1d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.set_interval_1d', params: p });
  });
  register('vgplot.clear_interval_1d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.clear_interval_1d', params: p });
  });
  register('vgplot.set_interval_2d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.set_interval_2d', params: p });
  });
  register('vgplot.clear_interval_2d', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeIntervalAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.clear_interval_2d', params: p });
  });

  register('vgplot.set_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeToggleAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.set_toggle', params: p });
  });
  register('vgplot.clear_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeToggleAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.clear_toggle', params: p });
  });

  register('vgplot.set_legend_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeLegendToggleAction(plot, {
      callId: crypto.randomUUID(),
      name: 'vgplot.set_legend_toggle',
      params: p,
    });
  });
  register('vgplot.clear_legend_toggle', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeLegendToggleAction(plot, {
      callId: crypto.randomUUID(),
      name: 'vgplot.clear_legend_toggle',
      params: p,
    });
  });

  register('vgplot.clear_nearest', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeNearestAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.clear_nearest', params: p });
  });

  register('vgplot.set_region', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeRegionAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.set_region', params: p });
  });
  register('vgplot.clear_region', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executeRegionAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.clear_region', params: p });
  });

  register('vgplot.set_pan_zoom', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executePanZoomAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.set_pan_zoom', params: p });
  });
  register('vgplot.clear_pan_zoom', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { plot } = resolvePlot(p);
    return executePanZoomAction(plot, { callId: crypto.randomUUID(), name: 'vgplot.clear_pan_zoom', params: p });
  });

  register('vgplot.set_input_option_index', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'vgplot.set_input_option_index', params }),
  );
  register('vgplot.set_input_value', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'vgplot.set_input_value', params }),
  );
  register('vgplot.clear_input', async (params) =>
    executeInputAction(resolveInput((params ?? {}) as any), { name: 'vgplot.clear_input', params }),
  );

  register('vgplot.table_set_sort', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { table } = resolveTable(p);
    return await executeTableAction(table, { name: 'vgplot.table_set_sort', params: p });
  });
  register('vgplot.table_clear_sort', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { table } = resolveTable(p);
    return await executeTableAction(table, { name: 'vgplot.table_clear_sort', params: p });
  });
  register('vgplot.table_set_page', async (params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const { table } = resolveTable(p);
    return await executeTableAction(table, { name: 'vgplot.table_set_page', params: p });
  });
}
