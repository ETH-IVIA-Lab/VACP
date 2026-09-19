import type { VacpActionExecutionOptions, VacpAvailability } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type { VacpActionDescriptor, VacpRef, VacpWidgetOptionsParams, VacpWidgetOptionsResult } from '@vacp/protocol';
import { VACP_WIDGET_OPTIONS_ACTION } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry';

export type VacpWidgetOptionsHandler = (
  params: VacpWidgetOptionsParams,
  options: VacpActionExecutionOptions,
) => VacpWidgetOptionsResult | Promise<VacpWidgetOptionsResult>;

const paramsSchema = z.object({
  ref: vacpRefSchema,
  offset: z.coerce.number().finite().nonnegative().default(0).transform(Math.floor),
  limit: z.coerce.number().finite().positive().max(2000).default(200).transform(Math.floor),
  query: z.string().max(200).optional(),
});

/**
 * Register the standard action `vacp.widget_options`.
 *
 * Intended for Menu-like widgets where agents need to discover available
 * values/labels before calling provider-specific input actions.
 */
export function registerVacpWidgetOptionsAction(
  registry: VacpActionRegistrar,
  handler: VacpWidgetOptionsHandler,
  options?: { availability?: VacpAvailability; inputRefs?: VacpRef[]; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    availability: options?.availability,
    name: VACP_WIDGET_OPTIONS_ACTION,
    description:
      options?.description ??
      'List available options for a Widget ref (e.g., menus). Use this to map from labels to values/indices for downstream input actions.',
    operation: {
      contract: VACP_WIDGET_OPTIONS_ACTION,
      kind: 'query',
      inputRefs: options?.inputRefs,
      refParameters: [{ parameter: 'ref', role: 'input' }],
      results: [{ role: 'state', description: 'Available values for the widget' }],
    },
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The vacp:// ref of a Widget node.' },
        offset: { type: 'number', description: 'Pagination offset (default: 0).' },
        limit: { type: 'number', description: 'Max options to return (default: 200).' },
        query: { type: 'string', description: 'Optional substring filter applied to label/value.' },
      },
      required: ['ref'],
      examples: [{ ref: 'vacp://.../input/0', query: 'judo' }],
    },
  };

  return registry.register(descriptor, handler, { parse: (value) => paramsSchema.parse(value) });
}
