import type { VacpActionExecutionOptions, VacpAvailability } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type { VacpActionDescriptor, VacpDataSqlParams, VacpRef } from '@vacp/protocol';
import { VACP_DATA_SQL_ACTION, VACP_TOOL_RESULT_LIMITS } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry';

export type VacpDataSqlHandler = (
  params: VacpDataSqlParams,
  options: VacpActionExecutionOptions,
) => unknown | Promise<unknown>;

const paramsSchema = z.object({
  handleRef: vacpRefSchema,
  sql: z.string().refine((sql) => sql.trim().length > 0),
  format: z.enum(['json', 'arrow_ipc_base64']).optional(),
  maxRows: z.number().int().positive().max(VACP_TOOL_RESULT_LIMITS.items).optional(),
});

/**
 * Register the standard action `vacp.data_sql`.
 *
 * This action is the primary data access mechanism in this repo:
 * callers provide a DataHandle ref + a SQL query, and the provider executes it
 * against an in-browser DuckDB (WASM) database.
 *
 * Providers decide how a DataHandle maps to DuckDB relations and how the
 * current selection is represented (for example as a view bound to
 * `vacp_handle`).
 */
export function registerVacpDataSqlAction(
  registry: VacpActionRegistrar,
  handler: VacpDataSqlHandler,
  options?: { availability?: VacpAvailability; enabled?: boolean; inputRefs?: VacpRef[]; description?: string },
): VacpActionDescriptor | null {
  if (options?.enabled === false) return null;

  const descriptor: VacpActionDescriptor = {
    availability: options?.availability,
    name: VACP_DATA_SQL_ACTION,
    description:
      options?.description ??
      'Run a DuckDB SQL query over a VACP DataHandle. Providers define the mapping. `vacp_handle` and `vacp_all` are reserved. Prefer semantic, human-like interaction actions first. Use SQL only when the app cannot express the needed question through available actions.',
    operation: {
      contract: VACP_DATA_SQL_ACTION,
      kind: 'query',
      inputRefs: options?.inputRefs,
      refParameters: [{ parameter: 'handleRef', role: 'input' }],
      results: [{ role: 'data', description: 'Query result from the selected data handle' }],
    },
    parameters: {
      type: 'object',
      properties: {
        handleRef: { type: 'string', description: 'The vacp:// ref of a DataHandle node.' },
        sql: {
          type: 'string',
          description:
            'SQL query to run. Use reserved identifiers `vacp_handle` (selected) and `vacp_all` (unfiltered).',
        },
        format: {
          type: 'string',
          enum: ['json', 'arrow_ipc_base64'],
          description:
            'Result encoding (default: json). `arrow_ipc_base64` is an Arrow IPC stream for programs that call the bridge. Tool results cut long strings, so agents read json.',
        },
        maxRows: {
          type: 'integer',
          minimum: 1,
          maximum: VACP_TOOL_RESULT_LIMITS.items,
          description: `Max rows a JSON result returns (default and most: ${VACP_TOOL_RESULT_LIMITS.items}). \`truncated\` says whether the query had more.`,
        },
      },
      required: ['handleRef', 'sql'],
    },
  };

  return registry.register(descriptor, handler, { parse: (value) => paramsSchema.parse(value) });
}
