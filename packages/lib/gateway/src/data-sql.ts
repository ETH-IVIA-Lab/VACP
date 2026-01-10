import type { VacpActionDescriptor, VacpDataSqlParams, VacpRef } from '@vacp/core';
import { isVacpRef, VACP_DATA_SQL_ACTION } from '@vacp/core';

import { VacpActionRegistry } from './action-registry';

export type VacpDataSqlHandler = (params: VacpDataSqlParams) => unknown | Promise<unknown>;

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
  registry: VacpActionRegistry,
  handler: VacpDataSqlHandler,
  options?: { targetRef?: VacpRef; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    name: VACP_DATA_SQL_ACTION,
    description:
      options?.description ??
      'Run a DuckDB SQL query over a VACP DataHandle (provider-defined mapping; `vacp_handle`/`vacp_all` are reserved). Prefer semantic, human-like interaction actions first; use SQL only when the app cannot express the needed question via available actions.',
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

  registry.register(descriptor, async (params) => {
    const p = (params ?? {}) as Partial<VacpDataSqlParams> | null;
    if (!p || typeof p !== 'object') throw new Error('Expected params to be an object');
    if (!isVacpRef(p.handleRef)) throw new Error('Expected params.handleRef to be a vacp:// ref');
    if (typeof p.sql !== 'string' || !p.sql.trim()) throw new Error('Expected params.sql to be a non-empty string');
    const maxRows = p.maxRows;
    if (maxRows !== undefined && (!Number.isFinite(maxRows) || maxRows <= 0)) {
      throw new Error('Expected params.maxRows to be a positive number');
    }
    const format = p.format;
    if (format !== undefined && format !== 'json' && format !== 'arrow_ipc_base64') {
      throw new Error('Expected params.format to be "json" or "arrow_ipc_base64"');
    }
    return handler({
      handleRef: p.handleRef,
      sql: p.sql,
      format,
      maxRows,
    });
  });

  return descriptor;
}
