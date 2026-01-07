import type { VacpActionDescriptor } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { makeViewRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike } from './types';

export function actionDescriptorsForDashboard(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  inputs: CollectedInput[];
  options: InstallVacpOnVgplotDashboardOptions;
}): VacpActionDescriptor[] {
  const hasInterval1D = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
  const hasInterval2D = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval2D'));
  const hasToggle = args.plots.some((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Toggle'));
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

  return actions;
}
