import type { VacpActionDescriptor } from '@ethivia/vacp-protocol';
import type { VgplotBindings } from './bindings';
import { hasIndexedOptions } from './inputs';
import { isSelectionBackedNearest } from './interactors/nearest';
import { interactorType } from './native-classes';
import { makeViewRef } from './refs';
import type { VgplotProviderOptions } from './types';

export function actionDescriptorsForDashboard({
  bindings,
  options,
}: {
  bindings: VgplotBindings;
  options: VgplotProviderOptions;
}): VacpActionDescriptor[] {
  const viewRef = makeViewRef({ ...options, suffix: '' });
  const actions: VacpActionDescriptor[] = [];
  const add = (
    name: string,
    title: string,
    description: string,
    properties: Record<string, unknown> = {},
    required: string[] = [],
  ) => {
    actions.push({
      name: `vgplot.${name}`,
      title,
      description,
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string' }, ...properties },
        required: ['ref', ...required],
      },
    });
  };
  const kinds = new Set(bindings.plots.flatMap(({ plot }) => bindings.interactors(plot).map(({ type }) => type)));
  const endpoint = { anyOf: [{ type: 'number' }, { type: 'string' }] };
  if (kinds.has('Interval1D')) {
    add(
      'set_interval_1d',
      'Brush range',
      'Set an Interval1D selection in domain coordinates.',
      { min: endpoint, max: endpoint },
      ['min', 'max'],
    );
    add('clear_interval_1d', 'Clear range', 'Clear an Interval1D selection.');
  }
  if (kinds.has('Interval2D')) {
    add(
      'set_interval_2d',
      'Brush region',
      'Set an Interval2D selection in domain coordinates.',
      { x0: endpoint, x1: endpoint, y0: endpoint, y1: endpoint },
      ['x0', 'x1', 'y0', 'y1'],
    );
    add('clear_interval_2d', 'Clear region', 'Clear an Interval2D selection.');
  }
  for (const [kind, name, title] of [
    ['Toggle', 'toggle', 'points'],
    ['Region', 'region', 'region'],
  ] as const) {
    if (!kinds.has(kind)) continue;
    add(`set_${name}`, `Select ${title}`, `Set a ${kind} selection.`, { value: {} }, ['value']);
    add(`clear_${name}`, `Clear ${title}`, `Clear a ${kind} selection.`);
  }
  if (
    bindings.plots.some(({ plot }) =>
      bindings.interactors(plot).some(({ interactor }) => isSelectionBackedNearest(interactor)),
    )
  )
    add('clear_nearest', 'Clear hover', 'Clear a selection-backed Nearest interaction.');
  if (kinds.has('PanZoom')) {
    add('set_pan_zoom', 'Change view', 'Set a PanZoom view domain.', {
      x0: { type: 'number' },
      x1: { type: 'number' },
      y0: { type: 'number' },
      y1: { type: 'number' },
    });
    add('clear_pan_zoom', 'Reset view', 'Clear a PanZoom view domain.');
  }
  if (
    bindings.plots.some(({ plot }) =>
      bindings.legends(plot).some(({ legend }) => interactorType(legend.handler) === 'Toggle'),
    )
  ) {
    add('set_legend_toggle', 'Select legend values', 'Set an interactive legend selection.', { value: {} }, ['value']);
    add('clear_legend_toggle', 'Clear legend selection', 'Clear an interactive legend selection.');
  }
  if (bindings.inputs.some(hasIndexedOptions))
    add(
      'set_input_option_index',
      'Select option',
      'Set a VGPlot input widget by option index.',
      { index: { type: 'integer', minimum: 0 } },
      ['index'],
    );
  if (bindings.inputs.length) {
    add(
      'set_input_value',
      'Set control',
      'Set a VGPlot input widget value. Sliders apply their native bounds and step and return the value held by the control.',
      { value: {} },
      ['value'],
    );
    add('clear_input', 'Reset control', 'Clear or reset a VGPlot input widget.');
  }
  if (bindings.tables.length) {
    add(
      'table_set_sort',
      'Sort table',
      'Sort a VGPlot table by a column.',
      { column: { type: 'string' }, desc: { type: 'boolean' } },
      ['column'],
    );
    add('table_clear_sort', 'Reset sorting', 'Clear the sort order for a VGPlot table.');
    add('table_set_page', 'Change table page', 'Set VGPlot table pagination.', {
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1 },
    });
  }
  return actions;
}
