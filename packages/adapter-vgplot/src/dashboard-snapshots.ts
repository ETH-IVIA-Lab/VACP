import { readInteractorSelection, type VgplotBindings } from './bindings';
import { legendValue } from './legends';
import { vacpDataHandle, type VacpDataSchemaTable, type VacpGraphFragment, type VacpRef } from '@vacp/protocol';
import type { VacpAnalyticalProjection } from '@vacp/runtime';
import { describeDuckDbTable } from '@vacp/data-duckdb';

import { readInputValue } from './inputs';
import type { VgplotDataHandle } from './data-handles';
import { whereClauseForVgplotTable } from './duckdb-selection';
import { isSelectionBackedNearest } from './interactors/nearest';
import type { VgplotProviderOptions, VgplotInteractorLike, VgplotScaleLike } from './types';

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
    if (depth >= 2) return '[Object]';
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
}): { project: () => Promise<VacpAnalyticalProjection> } {
  const { bindings, options, dataHandles } = args;
  const { inputs, plots, tables } = bindings;

  // A table's columns are read once, when a projection first names it.
  const described = new Map<string, Promise<VacpDataSchemaTable | null>>();
  const describe = (table: string) => {
    let schema = described.get(table);
    if (!schema) {
      schema = describeDuckDbTable({ duckdb: options.duckdbClient!, table }).catch(() => {
        described.delete(table);
        return null;
      });
      described.set(table, schema);
    }
    return schema;
  };
  const schemas = async () =>
    new Map(
      await Promise.all(
        dataHandles.map(
          async (handle) => [handle.ref, options.duckdbClient ? await describe(handle.table) : null] as const,
        ),
      ),
    );

  const getState = (): Record<VacpRef, unknown> => {
    const state: Record<VacpRef, unknown> = {};
    for (const group of bindings.selections) {
      const source = group.selection.active?.source;
      const activeSource =
        source == null ? null : [...group.sources].find(([, candidate]) => candidate === source)?.[0];
      state[group.ref] = { kind: 'Selection', activeSource };
    }

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
      bindings.interactors(plot).forEach(({ interactor, type, ref: interactorRef }) => {
        const anyI = interactor;
        const kind = type ?? 'Interactor';
        const rawValue = interactor.selection?.valueFor ? readInteractorSelection(interactor) : interactor.value;

        const selectionValue =
          kind === 'Nearest'
            ? safeStateValue(readNearestValue(anyI, rawValue))
            : safeStateValue(readInteractorSelection(interactor));

        const domain =
          kind === 'Interval1D'
            ? { domain: readScaleDomain(anyI.scale) }
            : kind === 'Interval2D'
              ? { xDomain: readScaleDomain(anyI.xscale), yDomain: readScaleDomain(anyI.yscale) }
              : kind === 'PanZoom'
                ? { xDomain: readScaleDomain(anyI.xscale), yDomain: readScaleDomain(anyI.yscale) }
                : null;

        state[interactorRef] = {
          kind,
          plotId,
          value: safeStateValue(rawValue),
          selectionValue,
          ...(kind === 'Nearest' ? { selectionBacked: isSelectionBackedNearest(interactor) } : null),
          ...domain,
          ...(kind === 'PanZoom'
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

    return state;
  };

  return {
    project: async () => {
      const tableSchemas = await schemas();
      const state = getState();
      const surfaces = { plots: plots.map((p) => p.plot), tables: tables.map((t) => t.table) };
      // Mosaic reports no revision for its tables, so only the host's hook can state a current row count.
      const handles = new Map(
        await Promise.all(
          dataHandles.map(async (handle) => {
            const columns = tableSchemas.get(handle.ref)?.columns;
            const selectionWhere = whereClauseForVgplotTable(handle.table, surfaces);
            const read = { ref: handle.ref, table: handle.table, columns, rowCount: null, selectionWhere };
            return [handle.ref, await vacpDataHandle(read, options.describeDataHandle)] as const;
          }),
        ),
      );
      for (const [ref, handle] of handles) state[ref] = handle.state;
      const nodes = args.graph.nodes.map((node) => {
        const handle = handles.get(node.ref);
        return handle ? { ...node, data: handle.data } : node;
      });
      return { graph: { ...args.graph, nodes }, state };
    },
  };
}
