import type { VacpDataSchemaColumn, VacpRef } from './schema';
import type { JsonObject } from './value';

/**
 * A DataHandle node's `data`: the relation `vacp_handle` reads, its columns once the provider knows
 * them, and what the host states the data is. The node's description says what the rows are and how
 * selections narrow them.
 */
export type VacpDataHandleData = {
  table: string;
  columns?: VacpDataSchemaColumn[];
  metadata?: JsonObject;
};

/** A DataHandle's state: the rows its relation holds, the SQL predicate narrowing `vacp_handle`, and host figures. */
export type VacpDataHandleState = {
  kind: 'DataHandle';
  /** The rows the relation holds now, or null when neither the provider nor the host has a current count. */
  rowCount: number | null;
  /** The predicate the current selections add over the relation's columns, or null when none narrows it. */
  selectionWhere: string | null;
  stats?: JsonObject;
};

/** Facts a host states about a DataHandle's data, beyond what its provider reads itself. */
export type VacpDataHandleFacts = {
  /** The rows the relation holds now. It takes the place of the provider's own count, known or not. */
  rowCount?: number;
  /** What the data is, such as its source, grain, or units. It reaches models as the node's `data.metadata`. */
  metadata?: JsonObject;
  /** Current figures about the data, such as when it loaded. They reach models as the handle's `stats` state. */
  stats?: JsonObject;
};

/**
 * A host's hook stating facts about one DataHandle, called with the handle's ref and the relation its
 * SQL reads each time the provider projects it. Answer from what the host already knows, since every
 * graph and state read waits for it. Returning nothing, or failing, adds no facts.
 */
export type VacpDataHandleDescriber = (handle: {
  ref: VacpRef;
  table: string;
}) => VacpDataHandleFacts | undefined | Promise<VacpDataHandleFacts | undefined>;

/**
 * A DataHandle's node data and state from what its provider read, with the facts `describe` states.
 * A host's row count takes the place of the provider's, so a provider without a witness can still
 * report a current count when its host has one.
 */
export async function vacpDataHandle(
  read: {
    ref: VacpRef;
    table: string;
    columns?: VacpDataSchemaColumn[];
    rowCount: number | null;
    selectionWhere: string | null;
  },
  describe?: VacpDataHandleDescriber,
): Promise<{ data: VacpDataHandleData; state: VacpDataHandleState }> {
  const facts = await Promise.resolve()
    .then(() => describe?.({ ref: read.ref, table: read.table }))
    .catch(() => undefined);
  return {
    data: {
      table: read.table,
      ...(read.columns ? { columns: read.columns } : {}),
      ...(facts?.metadata ? { metadata: facts.metadata } : {}),
    },
    state: {
      kind: 'DataHandle',
      rowCount: facts?.rowCount ?? read.rowCount,
      selectionWhere: read.selectionWhere,
      ...(facts?.stats ? { stats: facts.stats } : {}),
    },
  };
}
