import type { VacpActionExecutionOptions } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type { VacpActionDescriptor, VacpDataSchemaParams, VacpDataSchemaResult, VacpRef } from '@vacp/protocol';
import { VACP_DATA_SCHEMA_ACTION } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry';

export type VacpDataSchemaHandler = (
  params: VacpDataSchemaParams,
  options: VacpActionExecutionOptions,
) => VacpDataSchemaResult | Promise<VacpDataSchemaResult>;

const paramsSchema = z.object({
  handleRef: vacpRefSchema,
  detail: z.enum(['columns', 'full']).optional(),
  sampleRows: z.number().finite().nonnegative().optional(),
});

/**
 * Register the standard action `vacp.data_schema`.
 *
 * This action is intentionally provider-defined:
 * providers decide how a DataHandle maps to an underlying relation and which
 * schema details can be returned efficiently.
 */
export function registerVacpDataSchemaAction(
  registry: VacpActionRegistrar,
  handler: VacpDataSchemaHandler,
  options?: { targetRef?: VacpRef; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    name: VACP_DATA_SCHEMA_ACTION,
    description:
      options?.description ??
      'Return a DataHandle schema summary (columns/types, row count, and optional bounded summaries). Use this before writing `vacp.data_sql` queries to avoid column-name/type guesswork.',
    targetRef: options?.targetRef,
    parameters: {
      type: 'object',
      properties: {
        handleRef: { type: 'string', description: 'The vacp:// ref of a DataHandle node.' },
        detail: { type: 'string', enum: ['columns', 'full'], description: 'Detail level (default: columns).' },
        sampleRows: {
          type: 'number',
          description: 'Bounds rows scanned for summaries when detail=full. Providers tune the default for speed.',
        },
      },
      required: ['handleRef'],
      examples: [{ handleRef: 'vacp://.../data/main', detail: 'columns' }],
    },
  };

  registry.register(descriptor, (params, executionOptions) => {
    const parsed = paramsSchema.parse(params);

    return handler(parsed, executionOptions);
  });

  return descriptor;
}
