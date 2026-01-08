import type { VacpActionDescriptor } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { makeViewRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike, VgplotTableLike } from './types';

export function actionDescriptorsForDashboard(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
  inputs: CollectedInput[];
  options: InstallVacpOnVgplotDashboardOptions;
}): VacpActionDescriptor[] {
  const hasInterval1D = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
  const hasInterval2D = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval2D'));
  const hasToggle = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Toggle'));
  const hasNearest = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Nearest'));
  const hasRegion = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Region'));
  const hasPanZoom = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'PanZoom'));
  const hasLegendToggle = args.plots.some((p) =>
    (p.plot.legends ?? []).some((raw) => {
      const legend = raw && typeof raw === 'object' && 'legend' in raw ? (raw as any).legend : (raw as any);
      return !!legend?.selection;
    }),
  );
  const hasTables = (args.tables ?? []).length > 0;
  const hasInputs = args.inputs.length > 0;

  const viewRef = makeViewRef({ appId: args.options.appId, viewId: args.options.viewId, suffix: '' });
  const actions: VacpActionDescriptor[] = [];

  if (hasInterval1D) {
    actions.push({
      name: 'mosaic.set_interval_1d',
      description: 'Set a 1D interval selection (domain units).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: {
          plotId: { type: 'string' },
          interactorId: { type: 'string' },
          min: { type: 'number' },
          max: { type: 'number' },
        },
        required: ['interactorId', 'min', 'max'],
      },
    });
    actions.push({
      name: 'mosaic.clear_interval_1d',
      description: 'Clear a 1D interval selection.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        required: ['interactorId'],
      },
    });
  }

  if (hasInterval2D) {
    actions.push({
      name: 'mosaic.set_interval_2d',
      description: 'Set a 2D interval selection (x/y domain units).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: {
          plotId: { type: 'string' },
          interactorId: { type: 'string' },
          x0: { type: 'number' },
          x1: { type: 'number' },
          y0: { type: 'number' },
          y1: { type: 'number' },
        },
        required: ['interactorId', 'x0', 'x1', 'y0', 'y1'],
      },
    });
    actions.push({
      name: 'mosaic.clear_interval_2d',
      description: 'Clear a 2D interval selection.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        required: ['interactorId'],
      },
    });
  }

  if (hasToggle) {
    actions.push({
      name: 'mosaic.set_toggle',
      description: 'Set a Toggle interactor value (best-effort).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' }, value: {} },
        required: ['interactorId', 'value'],
      },
    });
    actions.push({
      name: 'mosaic.clear_toggle',
      description: 'Clear a Toggle interactor value.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        required: ['interactorId'],
      },
    });
  }

  if (hasNearest) {
    actions.push({
      name: 'mosaic.set_nearest',
      description: 'Set a Nearest (hover/inspect) interactor value (best-effort).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' }, value: {} },
        required: ['interactorId', 'value'],
      },
    });
    actions.push({
      name: 'mosaic.clear_nearest',
      description: 'Clear a Nearest (hover/inspect) interactor value.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        required: ['interactorId'],
      },
    });
  }

  if (hasRegion) {
    actions.push({
      name: 'mosaic.set_region',
      description: 'Set a Region (categorical) selection value (best-effort).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' }, value: {} },
        required: ['interactorId', 'value'],
      },
    });
    actions.push({
      name: 'mosaic.clear_region',
      description: 'Clear a Region selection.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        required: ['interactorId'],
      },
    });
  }

  if (hasPanZoom) {
    actions.push({
      name: 'mosaic.set_pan_zoom',
      description: 'Set a PanZoom view domain (best-effort).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: {
          plotId: { type: 'string' },
          interactorId: { type: 'string' },
          x0: { type: 'number' },
          x1: { type: 'number' },
          y0: { type: 'number' },
          y1: { type: 'number' },
        },
        required: ['interactorId'],
      },
    });
    actions.push({
      name: 'mosaic.clear_pan_zoom',
      description: 'Clear a PanZoom view domain (best-effort).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        required: ['interactorId'],
      },
    });
  }

  if (hasLegendToggle) {
    actions.push({
      name: 'mosaic.set_legend_toggle',
      description: 'Set an interactive legend (categorical) selection.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, channel: { type: 'string' }, value: {} },
        required: ['value'],
      },
    });
    actions.push({
      name: 'mosaic.clear_legend_toggle',
      description: 'Clear an interactive legend selection.',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, channel: { type: 'string' } },
      },
    });
  }

  if (hasInputs) {
    actions.push({
      name: 'mosaic.set_input_option_index',
      description: 'Set a Mosaic input widget (Menu/Slider/etc.) by option index (0-based).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string' }, index: { type: 'number' } },
        required: ['ref', 'index'],
      },
    });
    actions.push({
      name: 'mosaic.set_input_value',
      description: 'Set a Mosaic input widget value (best-effort).',
      targetRef: viewRef,
      parameters: { type: 'object', properties: { ref: { type: 'string' }, value: {} }, required: ['ref', 'value'] },
    });
    actions.push({
      name: 'mosaic.clear_input',
      description: 'Clear/reset a Mosaic input widget (best-effort).',
      targetRef: viewRef,
      parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    });
  }

  if (hasTables) {
    actions.push({
      name: 'mosaic.table_set_sort',
      description: 'Sort a Mosaic table by a column (best-effort).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { tableId: { type: 'string' }, column: { type: 'string' }, desc: { type: 'boolean' } },
        required: ['column'],
      },
    });
    actions.push({
      name: 'mosaic.table_clear_sort',
      description: 'Clear the sort order for a Mosaic table.',
      targetRef: viewRef,
      parameters: { type: 'object', properties: { tableId: { type: 'string' } } },
    });
    actions.push({
      name: 'mosaic.table_set_page',
      description: 'Set Mosaic table pagination (offset/limit).',
      targetRef: viewRef,
      parameters: {
        type: 'object',
        properties: { tableId: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
      },
    });
  }

  return actions;
}
