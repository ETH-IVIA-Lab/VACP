import type { VacpActionDescriptor, VacpRef, VacpWidgetOptionsParams, VacpWidgetOptionsResult } from '@vacp/core';
import { isVacpRef, VACP_WIDGET_OPTIONS_ACTION } from '@vacp/core';

import { VacpActionRegistry } from './action-registry';

export type VacpWidgetOptionsHandler = (
  params: VacpWidgetOptionsParams,
) => VacpWidgetOptionsResult | Promise<VacpWidgetOptionsResult>;

/**
 * Register the standard action `vacp.widget_options`.
 *
 * Intended for Menu-like widgets where agents need to discover available
 * values/labels before calling provider-specific input actions.
 */
export function registerVacpWidgetOptionsAction(
  registry: VacpActionRegistry,
  handler: VacpWidgetOptionsHandler,
  options?: { targetRef?: VacpRef; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    name: VACP_WIDGET_OPTIONS_ACTION,
    description:
      options?.description ??
      'List available options for a Widget ref (e.g., menus). Use this to map from labels to values/indices for downstream input actions.',
    targetRef: options?.targetRef,
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The vacp:// ref of a Widget node.' },
        offset: { type: 'number', description: 'Pagination offset (default: 0).' },
        limit: { type: 'number', description: 'Max options to return (default: 200).' },
        query: { type: 'string', description: 'Optional substring filter applied to label/value.' },
      },
      required: ['ref'],
      examples: [{ ref: 'vacp://…/input/0', query: 'judo' }],
    },
  };

  registry.register(descriptor, async (params) => {
    const p = (params ?? {}) as Partial<VacpWidgetOptionsParams> | null;
    if (!p || typeof p !== 'object') throw new Error('Expected params to be an object');
    if (!isVacpRef(p.ref)) throw new Error('Expected params.ref to be a vacp:// ref');

    const offsetRaw = p.offset;
    const limitRaw = p.limit;
    const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
    const limit = limitRaw === undefined ? 200 : Number(limitRaw);
    if (!Number.isFinite(offset) || offset < 0) throw new Error('Expected params.offset to be a non-negative number');
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('Expected params.limit to be a positive number');

    if (limit > 2000) throw new Error('Expected params.limit <= 2000');

    const query = p.query;
    if (query !== undefined && (typeof query !== 'string' || query.length > 200)) {
      throw new Error('Expected params.query to be a string (max 200 chars)');
    }

    return await handler({
      ref: p.ref,
      offset: Math.floor(offset),
      limit: Math.floor(limit),
      query: typeof query === 'string' ? query : undefined,
    } as VacpWidgetOptionsParams);
  });

  return descriptor;
}
