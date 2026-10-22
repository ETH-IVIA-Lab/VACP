import type { VacpActionExecutionContext, VacpAvailability } from '@ethivia/vacp-protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@ethivia/vacp-protocol/validation';
import type { VacpActionDescriptor, VacpDataSchemaParams, VacpDataSchemaResult, VacpRef } from '@ethivia/vacp-protocol';
import { VACP_DATA_SCHEMA_ACTION } from '@ethivia/vacp-protocol';

import type { VacpActionRegistrar } from './action-registry';
import { parseVacpParams } from './params';

export type VacpDataSchemaHandler = (
  params: VacpDataSchemaParams,
  context: VacpActionExecutionContext,
) => VacpDataSchemaResult | Promise<VacpDataSchemaResult>;

const paramsSchema = z.object({
  handleRef: vacpRefSchema,
  detail: z.enum(['columns', 'full']).optional(),
  sampleRows: z.number().finite().nonnegative().optional(),
});

/** Register `vacp.data_schema`. The provider maps each DataHandle to its relations and their summaries. */
export function registerVacpDataSchemaAction(
  registry: VacpActionRegistrar,
  handler: VacpDataSchemaHandler,
  options?: { availability?: VacpAvailability; inputRefs?: VacpRef[]; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    availability: options?.availability,
    name: VACP_DATA_SCHEMA_ACTION,
    description:
      options?.description ??
      'Return a DataHandle schema summary (columns/types, row count, and optional bounded summaries). Use this before writing `vacp.data_sql` queries to avoid column-name/type guesswork.',
    operation: {
      contract: VACP_DATA_SCHEMA_ACTION,
      kind: 'query',
      inputRefs: options?.inputRefs,
      refParameters: [{ parameter: 'handleRef', role: 'input' }],
      results: [{ role: 'data', description: 'Schema and bounded data summaries' }],
    },
    parameters: {
      type: 'object',
      properties: {
        handleRef: { type: 'string', description: 'The vacp:// ref of a DataHandle node.' },
        detail: { type: 'string', enum: ['columns', 'full'], description: 'Detail level (default: columns).' },
        sampleRows: {
          type: 'number',
          minimum: 0,
          description: 'Bounds rows scanned for summaries when detail=full. Providers tune the default for speed.',
        },
      },
      required: ['handleRef'],
      examples: [{ handleRef: 'vacp://.../data/main', detail: 'columns' }],
    },
  };

  return registry.register(descriptor, handler, { parse: parseVacpParams(VACP_DATA_SCHEMA_ACTION, paramsSchema) });
}
