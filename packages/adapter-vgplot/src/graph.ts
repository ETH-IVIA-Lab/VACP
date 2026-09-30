import type {
  VacpActionDescriptor,
  VacpDataHandleData,
  VacpEdge,
  VacpGraphFragment,
  VacpNode,
  VacpRef,
} from '@vacp/protocol';
import { VACP_SCHEMA_VERSION, stableStringify, fnv1a64Hex } from '@vacp/protocol';
import { isNode } from '@uwdata/mosaic-sql';

import { makePlotRef, makeViewRef } from './refs';
import type { VgplotBindings } from './bindings';
import type { VgplotDataHandle } from './data-handles';
import type { VgplotProviderOptions } from './types';

/** Describe analytical fields without following native mark, plot or coordinator ownership. */
function fieldDescriptor(raw: unknown): unknown {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw == null) return raw;
  if (Array.isArray(raw)) return raw.slice(0, 2).filter((value) => typeof value === 'string');
  if (typeof raw !== 'object') return { type: 'unknown' };
  const field = raw as Record<string, unknown>;
  const descriptor: Record<string, unknown> = {};
  for (const key of ['type', 'name', 'column', 'field', 'col', 'channel']) {
    if (typeof field[key] === 'string') descriptor[key] = field[key];
  }
  if (field.type === 'CUSTOM') {
    const options = field.options;
    if (options && typeof options === 'object') {
      const values: Record<string, unknown> = {};
      for (const key of ['step', 'steps', 'minstep', 'nice', 'base', 'offset', 'interval']) {
        const value = (options as Record<string, unknown>)[key];
        if (
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        )
          values[key] = value;
      }
      descriptor.options = values;
    }
  } else if (isNode(raw)) {
    try {
      const sql = raw.toString();
      descriptor.sql = sql.slice(0, 4096);
      if (sql.length > 4096) descriptor.sqlHash = fnv1a64Hex(sql);
    } catch {
      // An unevaluated native expression may not have a SQL representation yet.
    }
  }
  return descriptor;
}

function channelName(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.length ? raw : fallback;
}

function fieldNameFromDescriptor(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length) return raw;

  if (Array.isArray(raw)) {
    // VGPlot shorthand encodings often use ["field", "col"] or ["col", ...].
    const a0 = raw[0];
    const a1 = raw[1];

    if (typeof a1 === 'string' && typeof a0 === 'string' && a0.toLowerCase() === 'field' && a1.length) return a1;

    if (typeof a0 === 'string' && a0.length) return a0;
  }

  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const keys = ['field', 'name', 'column', 'col'];

  for (const k of keys) {
    const v = rec[k];

    if (typeof v === 'string' && v.length) return v;
  }

  return null;
}

function markBaseId(mark: { index?: unknown }, markIdx: number): string {
  return typeof mark.index === 'number' ? String(mark.index) : `implicit-${markIdx}`;
}

function markRefSegment(baseId: string, occurrence: number, total: number): string {
  return total > 1 ? `${baseId}/occurrence/${occurrence}` : baseId;
}

export function buildDashboardGraph(args: {
  bindings: VgplotBindings;
  options: VgplotProviderOptions;
  actions: VacpActionDescriptor[];
  dataHandles?: VgplotDataHandle[];
}): VacpGraphFragment {
  const viewRef = makeViewRef({ appId: args.options.appId, viewId: args.options.viewId, suffix: '' });

  const nodes: VacpNode[] = [
    {
      ref: viewRef,
      kind: 'View',
      layer: 'ViewLayer',
      title: args.options.title,
      description: args.options.description,
      data: { provider: 'vgplot' },
    },
  ];

  const edges: VacpEdge[] = [];

  const dataHandleNodeAdded = new Set<VacpRef>();

  for (const input of args.bindings.inputs) {
    nodes.push({
      ref: input.ref,
      kind: 'Widget',
      layer: 'ConfigLayer',
      title: input.meta.label ?? `input ${input.inputId}`,
      description: `VGPlot input widget (${input.meta.kind})`,
      data: { inputId: input.inputId, ...input.meta },
    });
    edges.push({ from: viewRef, to: input.ref, kind: 'contains' });
  }

  for (const { plotId, plot, ref: plotRef } of args.bindings.plots) {
    nodes.push({
      ref: plotRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: plotId,
      description: 'VGPlot plot (part of a dashboard)',
      data: {
        plotId,
        width: (() => {
          try {
            return plot.getAttribute?.('width');
          } catch {
            return undefined;
          }
        })(),
        height: (() => {
          try {
            return plot.getAttribute?.('height');
          } catch {
            return undefined;
          }
        })(),
      },
    });
    edges.push({ from: viewRef, to: plotRef, kind: 'contains' });

    const markBaseIds = plot.marks.map((mark, markIdx) => markBaseId(mark, markIdx));
    const markBaseCounts = new Map<string, number>();
    markBaseIds.forEach((baseId) => markBaseCounts.set(baseId, (markBaseCounts.get(baseId) ?? 0) + 1));
    const markBaseOccurrences = new Map<string, number>();

    plot.marks.forEach((mark, markIdx) => {
      const baseId = markBaseIds[markIdx] ?? `implicit-${markIdx}`;
      const occurrence = markBaseOccurrences.get(baseId) ?? 0;
      markBaseOccurrences.set(baseId, occurrence + 1);
      const idxLabel = markRefSegment(baseId, occurrence, markBaseCounts.get(baseId) ?? 1);

      const markRef = makePlotRef({
        appId: args.options.appId,
        viewId: args.options.viewId,
        plotId,
        suffix: `/mark/${idxLabel}`,
      });

      const markTable = (() => {
        try {
          return mark.sourceTable?.() ?? undefined;
        } catch {
          return undefined;
        }
      })();

      nodes.push({
        ref: markRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: mark.type ?? 'mark',
        description: 'VGPlot mark',
        data: {
          type: mark.type,
          index: typeof mark.index === 'number' ? mark.index : undefined,
          implicitIndex: typeof mark.index === 'number' ? undefined : markIdx,
          occurrence: (markBaseCounts.get(baseId) ?? 1) > 1 ? occurrence : undefined,
          table: markTable,
          plotId,
        },
      });
      edges.push({ from: plotRef, to: markRef, kind: 'contains' });

      const channels = Array.isArray(mark.channels) ? mark.channels : [];
      channels.forEach((ch, channelIdx) => {
        const rawField = ch?.field;

        // Channels without a data field or expression do not produce graph nodes.
        if (rawField == null) return;

        const field = fieldDescriptor(rawField);
        const chName = channelName(ch?.channel, `channel-${channelIdx}`);

        const channelRef = makePlotRef({
          appId: args.options.appId,
          viewId: args.options.viewId,
          plotId,
          suffix: `/mark/${idxLabel}/encoding/${encodeURIComponent(chName)}`,
        });

        nodes.push({
          ref: channelRef,
          kind: 'EncodingChannel',
          layer: 'VisualizationLayer',
          title: chName,
          description: 'VGPlot mark encoding channel',
          data: {
            plotId,
            markIndex: typeof mark.index === 'number' ? mark.index : undefined,
            markImplicitIndex: typeof mark.index === 'number' ? undefined : markIdx,
            markOccurrence: (markBaseCounts.get(baseId) ?? 1) > 1 ? occurrence : undefined,
            channel: chName,
            as: typeof ch?.as === 'string' ? ch.as : undefined,
            field,
          },
        });
        edges.push({ from: markRef, to: channelRef, kind: 'contains' });

        const name = fieldNameFromDescriptor(rawField);

        const fieldId = name ? `field-${encodeURIComponent(name)}` : `field-${fnv1a64Hex(stableStringify(field))}`;

        const fieldRef = makePlotRef({
          appId: args.options.appId,
          viewId: args.options.viewId,
          plotId,
          suffix: `/mark/${idxLabel}/encoding/${encodeURIComponent(chName)}/${fieldId}`,
        });

        const title = name ?? `expression (${fieldId.replace(/^field-/, '')})`;
        nodes.push({
          ref: fieldRef,
          kind: 'EncodedField',
          layer: 'DataLayer',
          title,
          description: `Data binding for mark channel "${chName}"${markTable ? ` (table: ${markTable})` : ''}.`,
          data: {
            plotId,
            markIndex: typeof mark.index === 'number' ? mark.index : undefined,
            markImplicitIndex: typeof mark.index === 'number' ? undefined : markIdx,
            markOccurrence: (markBaseCounts.get(baseId) ?? 1) > 1 ? occurrence : undefined,
            channel: chName,
            as: typeof ch?.as === 'string' ? ch.as : undefined,
            table: markTable,
            fieldName: name ?? undefined,
            field,
          },
        });
        edges.push({ from: channelRef, to: fieldRef, kind: 'contains' });
      });
    });

    args.bindings.legends(plot).forEach(({ legend, index, ref }) => {
      nodes.push({
        ref,
        kind: 'Legend',
        layer: 'InteractionFeedbackLayer',
        title: `${legend.channel} legend`,
        data: { plotId, legendId: String(index), channel: legend.channel, interactive: !!legend.selection },
      });
      edges.push({ from: plotRef, to: ref, kind: 'contains' });
    });

    args.bindings.interactors(plot).forEach(({ type, index: i, ref: interactorRef }) => {
      nodes.push({
        ref: interactorRef,
        kind: 'InteractionTarget',
        layer: 'InteractionFeedbackLayer',
        title: type ?? 'Interactor',
        description: 'VGPlot interactor (selection/brush)',
        data: { plotId, interactorId: String(i) },
      });
      edges.push({ from: plotRef, to: interactorRef, kind: 'contains' });
    });

    const handles = (args.dataHandles ?? []).filter((h) => h.surfaceKind === 'plot' && h.surfaceId === plotId);
    handles.forEach((h) => {
      if (!dataHandleNodeAdded.has(h.ref)) {
        dataHandleNodeAdded.add(h.ref);
        nodes.push({
          ref: h.ref,
          kind: 'DataHandle',
          layer: 'DataLayer',
          title: `DuckDB: ${h.table}`,
          description:
            'Rows of a dashboard table. `vacp_handle` holds the rows matching the current plot selections and inputs, and `vacp_all` holds every row.',
          data: { table: h.table } satisfies VacpDataHandleData,
        });
      }

      edges.push({ from: plotRef, to: h.ref, kind: 'contains' });
    });
  }

  for (const { tableId, table, ref: tableRef } of args.bindings.tables) {
    nodes.push({
      ref: tableRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: tableId,
      description: 'VGPlot table (scroll/sort surface)',
      data: {
        tableId,
        from: typeof table.from === 'string' ? table.from : undefined,
        columns:
          table.schema?.map((field) => field.column) ?? (Array.isArray(table.columns) ? table.columns : undefined),
        limit: typeof table.limit === 'number' ? table.limit : undefined,
      },
    });
    edges.push({ from: viewRef, to: tableRef, kind: 'contains' });

    const handles = (args.dataHandles ?? []).filter((h) => h.surfaceKind === 'table' && h.surfaceId === tableId);
    handles.forEach((h) => {
      nodes.push({
        ref: h.ref,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: `DuckDB: ${h.table} (${tableId})`,
        description:
          "Rows behind a dashboard table view. `vacp_handle` holds the rows matching the current selections and inputs, and `vacp_all` holds every row. The view's sort and page live in the table's state.",
        data: { table: h.table } satisfies VacpDataHandleData,
      });
      edges.push({ from: tableRef, to: h.ref, kind: 'contains' });
    });
  }

  for (const group of args.bindings.selections) {
    nodes.push({ ref: group.ref, kind: 'Selection', layer: 'InteractionFeedbackLayer', title: 'Shared selection' });
    edges.push({ from: viewRef, to: group.ref, kind: 'contains' });
    for (const ref of group.sources.keys()) edges.push({ from: ref, to: group.ref, kind: 'updates' });
  }

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions: args.actions };
}
