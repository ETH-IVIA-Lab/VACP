import type { VacpActionDescriptor } from '@vacp/core';

import { makeRef } from './refs';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike } from './types';

export function actionsForSpec(options: InstallVacpOnVegaLiteOptions, spec: VegaLiteSpecLike): VacpActionDescriptor[] {
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const actions: VacpActionDescriptor[] = [];

  const hasParam = (spec.params ?? []).some((p) => !p.select);
  const hasSelection = (spec.params ?? []).some((p) => !!p.select);

  if (hasParam) {
    actions.push({
      name: 'vega_lite.set_param',
      description: 'Set a Vega-Lite variable parameter (implemented via Vega view signals).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'VACP ref of the Param node (vacp://.../param/<name>)' },
          value: {},
        },
        required: ['ref', 'value'],
      },
    });
  }

  if (hasSelection) {
    actions.push({
      name: 'vega_lite.set_selection',
      description: 'Set a Vega-Lite selection parameter (best-effort; updates the selection store when possible).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'VACP ref of the Selection node (vacp://.../param/<name>)' },
          value: {
            description: 'Selection value; usually an object like {field: value} or {x:[min,max], y:[min,max]}',
          },
        },
        required: ['ref', 'value'],
      },
    });
    actions.push({
      name: 'vega_lite.clear_selection',
      description: 'Clear a Vega-Lite selection parameter (best-effort; uses Vega signals).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'VACP ref of the Selection node (vacp://.../param/<name>)' },
        },
        required: ['ref'],
      },
    });
  }

  if (options.includeSetSignalAction) {
    actions.push({
      name: 'vega.set_signal',
      description: 'Set an arbitrary Vega signal by name (debugging; powerful).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: {},
        },
        required: ['name', 'value'],
      },
    });
  }

  return actions;
}
