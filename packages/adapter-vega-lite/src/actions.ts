import type { VacpActionDescriptor } from '@vacp/protocol';

import { collectVegaLiteParams } from './params';
import { makeRef } from './refs';
import type { VegaLiteProviderOptions, VegaLiteSpecLike } from './types';

export function actionsForSpec(options: VegaLiteProviderOptions, spec: VegaLiteSpecLike): VacpActionDescriptor[] {
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const actions: VacpActionDescriptor[] = [];

  const params = collectVegaLiteParams(spec);
  const hasParam = params.some((p) => !p.select);
  const hasSelection = params.some((p) => !!p.select);

  if (hasParam) {
    actions.push({
      name: 'vega_lite.set_param',
      title: 'Set parameter',
      description: 'Set a Vega-Lite variable parameter through Vega view signals.',
      operation: { kind: 'mutation', affects: [vizRef] },
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
      title: 'Set selection',
      description: 'Set a Vega-Lite selection parameter. Updates the selection store when possible.',
      operation: { kind: 'mutation', affects: [vizRef] },
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'VACP ref of the Selection node (vacp://.../param/<name>)' },
          value: {
            description:
              'Selection value, usually an object like { field: value } or { x: [min, max], y: [min, max] }.',
          },
        },
        required: ['ref', 'value'],
      },
    });
    actions.push({
      name: 'vega_lite.clear_selection',
      title: 'Clear selection',
      description: 'Clear a Vega-Lite selection parameter. Uses Vega signals when needed.',
      operation: { kind: 'mutation', affects: [vizRef] },
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
      title: 'Set signal',
      description: 'Set a named Vega signal for debugging.',
      operation: { kind: 'mutation', affects: [vizRef] },
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
