import type { VacpActionExecutionOptions, VacpAvailability } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol/validation';
import type { VacpActionDescriptor, VacpRef, VacpWidgetOptionsParams, VacpWidgetOptionsResult } from '@vacp/protocol';
import { VACP_WIDGET_OPTIONS_ACTION } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry';
import { parseVacpParams } from './params';

export type VacpWidgetOptionsHandler = (
  params: VacpWidgetOptionsParams,
  options: VacpActionExecutionOptions,
) => VacpWidgetOptionsResult | Promise<VacpWidgetOptionsResult>;

const MAX_LIMIT = 2000;
const MAX_QUERY = 200;

const paramsSchema = z.object({
  ref: vacpRefSchema,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(200),
  query: z.string().max(MAX_QUERY).optional(),
});

/** Register `vacp.widget_options`, which pages through a menu-like widget's options. */
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
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Pagination offset.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 200, description: 'Options to return.' },
        query: { type: 'string', maxLength: MAX_QUERY, description: 'Substring filter applied to labels and values.' },
      },
      required: ['ref'],
      examples: [{ ref: 'vacp://.../input/0', query: 'judo' }],
    },
  };

  return registry.register(descriptor, handler, { parse: parseVacpParams(VACP_WIDGET_OPTIONS_ACTION, paramsSchema) });
}
