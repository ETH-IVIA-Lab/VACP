import { jsonValue } from './json';
import { readScaleDomain } from './interactors/interval';
import { readInteractorSelection, type VgplotBindings } from './bindings';
import { legendValue } from './legends';
import { vacpDataHandle, type VacpDataSchemaColumn, type VacpGraphFragment, type VacpRef } from '@vacp/protocol';
import type { VacpAnalyticalProjection } from '@vacp/runtime';
import { describeDuckDbColumns } from '@vacp/data-duckdb';

import { readInputValue } from './inputs';
import type { VgplotDataHandle } from './data-handles';
import { whereClauseForVgplotTable } from './duckdb-selection';
import { isSelectionBackedNearest } from './interactors/nearest';
import type { VgplotInteractorLike } from './types';

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
  data:
    | {
        duckdb:
          | import('@vacp/data-duckdb').VacpDuckDbQueryClient
          | Promise<import('@vacp/data-duckdb').VacpDuckDbQueryClient>;
        describe?: import('@vacp/protocol').VacpDataHandleDescriber;
      }
    | undefined;
  bindings: VgplotBindings;
  dataHandles: VgplotDataHandle[];
}): { project: () => Promise<VacpAnalyticalProjection> } {
  const { bindings, data, dataHandles } = args;
  const { inputs, plots, tables } = bindings;

  // A table's columns are read once, when a projection first names it.
  const described = new Map<string, Promise<VacpDataSchemaColumn[] | null>>();
  const describe = (table: string) => {
    let schema = described.get(table);
    if (!schema) {
      schema = Promise.resolve(data!.duckdb)
        .then((duckdb) => describeDuckDbColumns({ duckdb, table }))
        .catch(() => {
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
        dataHandles.map(async (handle) => [handle.ref, data ? await describe(handle.table) : null] as const),
      ),
    );

  const getState = (): Record<VacpRef, unknown> => {
    const state: Record<VacpRef, unknown> = {};
    const capture = (ref: VacpRef, kind: string, read: () => object) => {
      try {
        state[ref] = { kind, ...read() };
      } catch (error) {
        state[ref] = { kind, readError: error instanceof Error ? error.message : String(error) };
      }
    };
    for (const group of bindings.selections) {
      const source = group.selection.active?.source;
      const activeSource =
        source == null ? null : [...group.sources].find(([, candidate]) => candidate === source)?.[0];
      state[group.ref] = { kind: 'Selection', activeSource };
    }

    for (const input of inputs) {
      capture(input.ref, 'Widget', () => {
        const inst = input.input;
        const selected = readInputValue(input);
        const selectionValue = jsonValue(selected.value);

        const optionCount = Array.isArray(inst.data)
          ? inst.data.length
          : inst.select?.options
            ? inst.select.options.length
            : undefined;

        return {
          widgetKind: input.meta.kind,
          selectionValue,
          optionCount,
          ...(!selected.ok ? { readError: selected.error } : null),
        };
      });
    }

    for (const { plotId, plot } of plots) {
      bindings.legends(plot).forEach(({ legend, ref }) => {
        capture(ref, 'Legend', () => ({
          channel: legend.channel,
          selectionValue: jsonValue(legendValue(legend)),
        }));
      });
      bindings.interactors(plot).forEach(({ interactor, type, ref: interactorRef }) => {
        const kind = type ?? 'Interactor';
        capture(interactorRef, kind, () => {
          const anyI = interactor;
          const rawValue = interactor.selection?.valueFor ? readInteractorSelection(interactor) : interactor.value;

          const selectionValue =
            kind === 'Nearest'
              ? jsonValue(readNearestValue(anyI, rawValue))
              : jsonValue(readInteractorSelection(interactor));

          const domain =
            kind === 'Interval1D'
              ? { domain: jsonValue(readScaleDomain(anyI.scale)) }
              : kind === 'Interval2D'
                ? { xDomain: jsonValue(readScaleDomain(anyI.xscale)), yDomain: jsonValue(readScaleDomain(anyI.yscale)) }
                : kind === 'PanZoom'
                  ? {
                      xDomain: jsonValue(readScaleDomain(anyI.xscale)),
                      yDomain: jsonValue(readScaleDomain(anyI.yscale)),
                    }
                  : null;

          return {
            plotId,
            selectionValue,
            ...(kind === 'Nearest' ? { selectionBacked: isSelectionBackedNearest(interactor) } : null),
            ...domain,
            ...(kind === 'PanZoom'
              ? {
                  x: jsonValue(anyI.xsel?.value ?? null),
                  y: jsonValue(anyI.ysel?.value ?? null),
                  xField: anyI.xfield ?? null,
                  yField: anyI.yfield ?? null,
                }
              : null),
          };
        });
      });
    }

    for (const { tableId, table, ref: tableRef } of tables) {
      capture(tableRef, 'Table', () => ({
        tableId,
        from: typeof table.from === 'string' ? table.from : undefined,
        sortColumn: table.sortColumn ?? null,
        sortDesc: Boolean(table.sortDesc),
        offset: typeof table.offset === 'number' ? table.offset : 0,
        limit: typeof table.limit === 'number' ? table.limit : null,
        selectionValue: jsonValue(table.selection?.value ?? undefined),
      }));
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
            const columns = tableSchemas.get(handle.ref) ?? undefined;
            let selectionWhere: string | null = null;
            let selectionError: string | undefined;
            try {
              selectionWhere = whereClauseForVgplotTable(handle.table, surfaces);
            } catch (error) {
              selectionError = error instanceof Error ? error.message : String(error);
            }
            const read = { ref: handle.ref, table: handle.table, columns, rowCount: null, selectionWhere };
            const captured = await vacpDataHandle(read, data?.describe);
            const { selectionWhere: _where, ...state } = captured.state;
            return [
              handle.ref,
              {
                data: captured.data,
                state: selectionError ? { ...state, selectionError } : captured.state,
                unavailable: selectionError,
              },
            ] as const;
          }),
        ),
      );
      for (const [ref, handle] of handles) state[ref] = handle.state;
      const nodes = args.graph.nodes.map((node) => {
        const handle = handles.get(node.ref);
        return handle
          ? {
              ...node,
              data: handle.data,
              availability: handle.unavailable ? { unavailable: handle.unavailable } : undefined,
            }
          : node;
      });
      return { graph: { ...args.graph, nodes }, state };
    },
  };
}
