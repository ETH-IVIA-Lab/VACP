import type { VacpActionExecutionOptions } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type { VacpActionDescriptor, VacpDataSqlParams, VacpRef } from '@vacp/protocol';
import { VACP_DATA_SQL_ACTION } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry';

export type VacpDataSqlHandler = (
  params: VacpDataSqlParams,
  options: VacpActionExecutionOptions,
) => unknown | Promise<unknown>;

const paramsSchema = z.object({
  handleRef: vacpRefSchema,
  sql: z.string().refine((sql) => sql.trim().length > 0),
  format: z.enum(['json', 'arrow_ipc_base64']).optional(),
  maxRows: z.number().finite().positive().optional(),
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
  options?: { enabled?: boolean; targetRef?: VacpRef; description?: string },
): VacpActionDescriptor | null {
  if (options?.enabled === false) return null;

  const descriptor: VacpActionDescriptor = {
    name: VACP_DATA_SQL_ACTION,
    description:
      options?.description ??
      'Run a DuckDB SQL query over a VACP DataHandle. Providers define the mapping. `vacp_handle` and `vacp_all` are reserved. Prefer semantic, human-like interaction actions first. Use SQL only when the app cannot express the needed question through available actions.',
    targetRef: options?.targetRef,
    parameters: {
      type: 'object',
      properties: {
        handleRef: { type: 'string', description: 'The vacp:// ref of a DataHandle node.' },
        sql: {
          type: 'string',
          description:
            'SQL query to run. Use reserved identifiers `vacp_handle` (selected) and `vacp_all` (unfiltered).',
        },
        format: { type: 'string', enum: ['json', 'arrow_ipc_base64'] },
        maxRows: { type: 'number', description: 'Max rows to return for JSON results (default: 500).' },
      },
      required: ['handleRef', 'sql'],
    },
  };

  registry.register(descriptor, (params, executionOptions) => {
    const parsed = paramsSchema.parse(params);

    return handler(parsed, executionOptions);
  });

  return descriptor;
}
