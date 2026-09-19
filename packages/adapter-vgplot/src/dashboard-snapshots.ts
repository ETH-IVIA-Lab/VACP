import type { VgplotBindings } from './bindings.js';
import { legendValue } from './legends.js';
import type { VacpGraphFragment, VacpRef } from '@vacp/protocol';
import type { VacpAnalyticalProjection } from '@vacp/runtime';
import {
  formatDuckDbTableMetadataSummary,
  getDuckDbTableMetadata,
  type VacpDuckDbTableMetadata,
} from '@vacp/data-duckdb';

import { readInputValue } from './inputs.js';
import { discoverPlotTables, type VgplotDataHandle } from './data-handles.js';
import { whereClauseForVgplotDashboardSelection } from './duckdb-selection.js';
import { isSelectionBackedNearest } from './interactors/nearest.js';
import type {
  VgplotProviderOptions,
  VgplotPlotLike,
  VgplotTableLike,
  VgplotInteractorLike,
  VgplotScaleLike,
} from './types.js';

type TablesById = Map<string, VgplotTableLike>;

type PlotsById = Map<string, VgplotPlotLike>;

function resolveHandleTableName(args: {
  handle: VgplotDataHandle;
  plotsById: PlotsById;
  tablesById: TablesById;
}): string | null {
  const h = args.handle;
  const plot = h.surfaceKind === 'plot' ? args.plotsById.get(h.surfaceId) : null;
  const tableObj = h.surfaceKind === 'table' ? args.tablesById.get(h.surfaceId) : null;

  return (
    h.table ??
    (plot ? discoverPlotTables(plot)[0] : null) ??
    (tableObj && typeof tableObj.from === 'string' ? tableObj.from : null) ??
    null
  );
}

function safeStateValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();

  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (Array.isArray(value)) {
    if (depth >= 4) return `[Array(${value.length})]`;
    const slice = value.slice(0, 24).map((entry) => safeStateValue(entry, seen, depth + 1));

    return value.length > slice.length ? [...slice, `... ${value.length - slice.length} more`] : slice;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    const ctor = value.constructor?.name && value.constructor.name !== 'Object' ? value.constructor.name : 'Object';

    if (depth >= 2) return `[${ctor}]`;
    seen.add(value);

    try {
      const out: Record<string, unknown> = {};
      const entries = Object.entries(value as Record<string, unknown>).slice(0, 24);

      for (const [key, entry] of entries) {
        const next = safeStateValue(entry, seen, depth + 1);

        if (next !== undefined) out[key] = next;
      }

      const total = Object.keys(value as Record<string, unknown>).length;

      if (total > entries.length) out.__truncated = `${total - entries.length} more keys`;

      return out;
    } finally {
      seen.delete(value);
    }
  }

  return String(value);
}

function readScaleDomain(scale: VgplotScaleLike | undefined): unknown[] | undefined {
  if (!scale) return undefined;
  const anyScale = scale;
  const raw = typeof anyScale.domain === 'function' ? (anyScale.domain as () => unknown)() : anyScale.domain;

  if (!Array.isArray(raw) || raw.length < 2) return undefined;

  return raw.map((value) => safeStateValue(value));
}

function readNearestValue(interactor: VgplotInteractorLike, rawValue: unknown) {
  if (rawValue !== undefined) return rawValue;
  const selection = interactor.selection;

  if (!selection || typeof selection !== 'object' || !('value' in selection)) return undefined;
  const value = selection.value;

  if (value && typeof value === 'object' && 'value' in value && 'predicate' in value) {
    return value.value;
  }

  return value;
}

export function createVgplotDashboardSnapshots(args: {
  graph: VacpGraphFragment;
  options: VgplotProviderOptions;
  bindings: VgplotBindings;
  dataHandles: VgplotDataHandle[];
  plotsById: PlotsById;
  tablesById: TablesById;
}): { project: () => Promise<VacpAnalyticalProjection> } {
  const { bindings, options, dataHandles, plotsById, tablesById } = args;
  const { inputs, plots, tables } = bindings;

  const dataHandleNodesByRef = new Map<VacpRef, any>();

  for (const n of args.graph.nodes) {
    if (n.kind !== 'DataHandle') continue;
    dataHandleNodesByRef.set(n.ref, n);
  }

  const duckdbMetaByTable = new Map<string, VacpDuckDbTableMetadata>();
  let duckdbMetaPromise: Promise<void> | null = null;

  const ensureDuckdbMeta = async () => {
    if (!options.duckdbClient || !dataHandles.length) return;

    if (duckdbMetaPromise) return await duckdbMetaPromise;
    duckdbMetaPromise = (async () => {
      for (const h of dataHandles) {
        const tableName = resolveHandleTableName({ handle: h, plotsById, tablesById });

        if (!tableName || duckdbMetaByTable.has(tableName)) continue;

        try {
          duckdbMetaByTable.set(
            tableName,
            await getDuckDbTableMetadata({
              duckdb: options.duckdbClient!,
              table: tableName,
              sampleRows: 0,
              maxNumericColumns: 0,
              maxTemporalColumns: 0,
              maxCategoricalColumns: 0,
            }),
          );
        } catch {
          // Ignore metadata failures so data handles remain queryable.
        }
      }

      for (const h of dataHandles) {
        const tableName = resolveHandleTableName({ handle: h, plotsById, tablesById });

        if (!tableName) continue;
        const meta = duckdbMetaByTable.get(tableName);

        if (!meta) continue;
        const node = dataHandleNodesByRef.get(h.ref);

        if (!node) continue;
        const prev = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>) : undefined;
        node.data = { ...prev, table: tableName, duckdb: meta };
        node.description = `DuckDB handle for "${tableName}".\n${formatDuckDbTableMetadataSummary(meta)}`;
      }
    })();
    await duckdbMetaPromise;
  };

  const getState = async (): Promise<Record<VacpRef, unknown>> => {
    const state: Record<VacpRef, unknown> = {};

    for (const input of inputs) {
      const inst = input.input;
      const selected = readInputValue(input);
      const selectionValue = safeStateValue(inst.selection?.value ?? undefined);

      const optionCount = Array.isArray(inst.data)
        ? inst.data.length
        : inst.select?.options
          ? inst.select.options.length
          : undefined;

      state[input.ref] = {
        kind: 'Widget',
        widgetKind: input.meta.kind,
        value: safeStateValue(selected.value),
        selectionValue,
        optionCount,
        ...(!selected.ok ? { readError: selected.error } : null),
      };
    }

    for (const { plotId, plot } of plots) {
      bindings.legends(plot).forEach(({ legend, ref }) => {
        state[ref] = {
          kind: 'Legend',
          channel: legend.channel,
          value: safeStateValue(legendValue(legend)),
        };
      });
      bindings.interactors(plot).forEach(({ interactor, ref: interactorRef }) => {
        const anyI = interactor;
        const ctorName = interactor.constructor?.name ?? 'Interactor';
        const rawValue = interactor.value;

        const selectionValue =
          ctorName === 'Nearest'
            ? safeStateValue(readNearestValue(anyI, rawValue))
            : safeStateValue(anyI.selection?.value ?? undefined);

        const domain =
          ctorName === 'Interval1D'
            ? { domain: readScaleDomain(anyI.scale) }
            : ctorName === 'Interval2D'
              ? { xDomain: readScaleDomain(anyI.xscale), yDomain: readScaleDomain(anyI.yscale) }
              : ctorName === 'PanZoom'
                ? { xDomain: readScaleDomain(anyI.xscale), yDomain: readScaleDomain(anyI.yscale) }
                : null;

        state[interactorRef] = {
          kind: ctorName,
          plotId,
          value: safeStateValue(rawValue),
          selectionValue,
          ...(ctorName === 'Nearest' ? { selectionBacked: isSelectionBackedNearest(interactor) } : null),
          ...domain,
          ...(ctorName === 'PanZoom'
            ? {
                x: safeStateValue(anyI.xsel?.value ?? null),
                y: safeStateValue(anyI.ysel?.value ?? null),
                xField: anyI.xfield ?? null,
                yField: anyI.yfield ?? null,
              }
            : null),
        };
      });
    }

    for (const { tableId, table, ref: tableRef } of tables) {
      state[tableRef] = {
        kind: 'Table',
        tableId,
        from: typeof table.from === 'string' ? table.from : undefined,
        sortColumn: table.sortColumn ?? null,
        sortDesc: Boolean(table.sortDesc),
        offset: typeof table.offset === 'number' ? table.offset : 0,
        limit: typeof table.limit === 'number' ? table.limit : null,
        selectionValue: safeStateValue(table.selection?.value ?? undefined),
      };
    }

    if (dataHandles.length) {
      const where = whereClauseForVgplotDashboardSelection({ plots: plots.map((p) => p.plot), inputs });
      dataHandles.forEach((h) => {
        const tableName = resolveHandleTableName({ handle: h, plotsById, tablesById });
        const tableObj = h.surfaceKind === 'table' ? tablesById.get(h.surfaceId) : null;
        state[h.ref] = {
          kind: 'DataHandle',
          table: tableName ?? undefined,
          selectionWhere: where,
          selectedMeaning: tableObj
            ? 'rows in the current table view (filters + sort + pagination)'
            : 'rows matching current plot selection, falling back to all rows if none',
        };
      });
    }

    return state;
  };

  return {
    project: async () => {
      await ensureDuckdbMeta();
      const { actions: _actions, ...graph } = args.graph;
      return { graph, state: await getState() };
    },
  };
}
