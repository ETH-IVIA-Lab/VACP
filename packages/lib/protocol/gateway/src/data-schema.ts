import type { VacpActionDescriptor, VacpDataSchemaParams, VacpDataSchemaResult, VacpRef } from '@vacp/core';
import { isVacpRef, VACP_DATA_SCHEMA_ACTION } from '@vacp/core';

import { VacpActionRegistry } from './action-registry';

export type VacpDataSchemaHandler = (
  params: VacpDataSchemaParams,
) => VacpDataSchemaResult | Promise<VacpDataSchemaResult>;

/**
 * Register the standard action `vacp.data_schema`.
 *
 * This action is intentionally provider-defined:
 * providers decide how a DataHandle maps to an underlying relation and which
 * schema details can be returned efficiently.
 */
export function registerVacpDataSchemaAction(
  registry: VacpActionRegistry,
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
          description:
            'When detail=full: bound rows scanned for summaries (provider-defined; default tuned for speed).',
        },
      },
      required: ['handleRef'],
      examples: [{ handleRef: 'vacp://…/data/main', detail: 'columns' }],
    },
  };

  registry.register(descriptor, async (params) => {
    const p = (params ?? {}) as Partial<VacpDataSchemaParams> | null;
    if (!p || typeof p !== 'object') throw new Error('Expected params to be an object');
    if (!isVacpRef(p.handleRef)) throw new Error('Expected params.handleRef to be a vacp:// ref');

    const detail = p.detail;
    if (detail !== undefined && detail !== 'columns' && detail !== 'full') {
      throw new Error('Expected params.detail to be "columns" or "full"');
    }

    const sampleRows = p.sampleRows;
    if (sampleRows !== undefined && (!Number.isFinite(sampleRows) || sampleRows < 0)) {
      throw new Error('Expected params.sampleRows to be a non-negative number');
    }

    return await handler({
      handleRef: p.handleRef,
      detail,
      sampleRows,
    } as VacpDataSchemaParams);
  });

  return descriptor;
}
