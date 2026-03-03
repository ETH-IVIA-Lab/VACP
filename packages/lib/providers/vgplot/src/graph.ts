import type { VacpActionDescriptor, VacpEdge, VacpGraph, VacpNode, VacpRef } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { makePlotRef, makeViewRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike, VgplotTableLike } from './types';

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (typeof v !== 'object') return v;
    const obj = v as object;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
    if (Array.isArray(v)) return v.map(walk);
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.keys(rec)
      .sort()
      .forEach((k) => {
        out[k] = walk(rec[k]);
      });
    return out;
  };
  return JSON.stringify(walk(value)) ?? 'null';
}

function safeJsonValue(value: unknown): unknown {
  try {
    return JSON.parse(stableStringify(value));
  } catch {
    return String(value);
  }
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned 32-bit hex.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function channelName(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.length ? raw : fallback;
}

function fieldNameFromDescriptor(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length) return raw;
  if (Array.isArray(raw)) {
    // Best-effort: common shorthand encodings like ["field", "col"] or ["col", ...].
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

export function buildDashboardGraph(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
  inputs: CollectedInput[];
  options: InstallVacpOnVgplotDashboardOptions;
  actions: VacpActionDescriptor[];
  dataHandles?: Array<{ ref: VacpRef; surfaceKind: 'plot' | 'table'; surfaceId: string; table?: string }>;
}): VacpGraph {
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

  const plotHandleUsageByRef = new Map<VacpRef, { table?: string; plotIds: Set<string> }>();
  for (const h of args.dataHandles ?? []) {
    if (h.surfaceKind !== 'plot') continue;
    const entry = plotHandleUsageByRef.get(h.ref) ?? { table: h.table, plotIds: new Set<string>() };
    if (!entry.table && h.table) entry.table = h.table;
    entry.plotIds.add(h.surfaceId);
    plotHandleUsageByRef.set(h.ref, entry);
  }
  const dataHandleNodeAdded = new Set<VacpRef>();

  for (const input of args.inputs) {
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

  for (const { plotId, plot } of args.plots) {
    const plotRef = makePlotRef({ appId: args.options.appId, viewId: args.options.viewId, plotId, suffix: '' });
    nodes.push({
      ref: plotRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: plotId,
      description: 'vgplot plot (part of a dashboard)',
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

    plot.marks.forEach((mark, markIdx) => {
      const idxLabel = typeof mark.index === 'number' ? String(mark.index) : `implicit-${markIdx}`;
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
        description: 'vgplot mark',
        data: {
          type: mark.type,
          index: typeof mark.index === 'number' ? mark.index : undefined,
          implicitIndex: typeof mark.index === 'number' ? undefined : markIdx,
          table: markTable,
          plotId,
        },
      });
      edges.push({ from: plotRef, to: markRef, kind: 'contains' });

      const channels = Array.isArray(mark.channels) ? mark.channels : [];
      channels.forEach((ch, channelIdx) => {
        const rawField = (ch as any)?.field;
        // Skip channels that don't encode a data field/expression to avoid polluting the graph.
        if (rawField == null) return;

        const chName = channelName((ch as any)?.channel, `channel-${channelIdx}`);
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
          description: 'vgplot mark encoding channel',
          data: {
            plotId,
            markIndex: typeof mark.index === 'number' ? mark.index : undefined,
            markImplicitIndex: typeof mark.index === 'number' ? undefined : markIdx,
            channel: chName,
            as: typeof (ch as any)?.as === 'string' ? (ch as any).as : undefined,
            field: safeJsonValue(rawField),
          },
        });
        edges.push({ from: markRef, to: channelRef, kind: 'contains' });

        const name = fieldNameFromDescriptor(rawField);
        const hashInput = (() => {
          try {
            return stableStringify(rawField);
          } catch {
            return String(rawField);
          }
        })();
        const fieldId = name ? `field-${encodeURIComponent(name)}` : `field-${fnv1a32(hashInput)}`;
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
            channel: chName,
            as: typeof (ch as any)?.as === 'string' ? (ch as any).as : undefined,
            table: markTable,
            fieldName: name ?? undefined,
            field: safeJsonValue(rawField),
          },
        });
        edges.push({ from: channelRef, to: fieldRef, kind: 'contains' });
      });
    });

    plot.interactors.forEach((it, i) => {
      const interactorRef = makePlotRef({
        appId: args.options.appId,
        viewId: args.options.viewId,
        plotId,
        suffix: `/interactor/${i}`,
      });
      nodes.push({
        ref: interactorRef,
        kind: 'InteractionTarget',
        layer: 'InteractionFeedbackLayer',
        title: it.constructor?.name ?? 'Interactor',
        description: 'vgplot interactor (selection/brush)',
        data: { plotId, interactorId: String(i) },
      });
      edges.push({ from: plotRef, to: interactorRef, kind: 'contains' });
    });

    const handles = (args.dataHandles ?? []).filter((h) => h.surfaceKind === 'plot' && h.surfaceId === plotId);
    handles.forEach((h) => {
      const usage = plotHandleUsageByRef.get(h.ref);
      const plotIds = usage ? Array.from(usage.plotIds).sort() : [plotId];
      const tableLabel = typeof h.table === 'string' && h.table ? h.table : 'data';

      if (!dataHandleNodeAdded.has(h.ref)) {
        dataHandleNodeAdded.add(h.ref);
        const shared = plotIds.length > 1;
        const title =
          tableLabel === 'data' && plotIds.length === 1 ? `DuckDB: data (${plotIds[0]})` : `DuckDB: ${tableLabel}`;
        const plotHint = shared ? `Used by plots: ${plotIds.join(', ')}.` : `Used by plot: ${plotIds[0]}.`;
        nodes.push({
          ref: h.ref,
          kind: 'DataHandle',
          layer: 'DataLayer',
          title,
          description: `DuckDB-backed handle for this dashboard dataset. ${plotHint} \`vacp_handle\` is the selected subset (or all rows if empty).`,
          data: { table: usage?.table ?? h.table, plotIds },
        });
      }
      edges.push({ from: plotRef, to: h.ref, kind: 'contains' });
    });
  }

  for (const { tableId, table } of args.tables ?? []) {
    const tableRef = makePlotRef({
      appId: args.options.appId,
      viewId: args.options.viewId,
      plotId: tableId,
      suffix: '',
    });
    nodes.push({
      ref: tableRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: tableId,
      description: 'vgplot table (scroll/sort surface)',
      data: {
        tableId,
        from: typeof table.from === 'string' ? table.from : undefined,
        columns: Array.isArray(table.columns) ? table.columns : undefined,
        limit: typeof table.limit === 'number' ? table.limit : undefined,
      },
    });
    edges.push({ from: viewRef, to: tableRef, kind: 'contains' });

    const handles = (args.dataHandles ?? []).filter((h) => h.surfaceKind === 'table' && h.surfaceId === tableId);
    handles.forEach((h) => {
      const tableLabel =
        (typeof h.table === 'string' && h.table) || (typeof table.from === 'string' && table.from) || 'data';
      nodes.push({
        ref: h.ref,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: `DuckDB: ${tableLabel} (${tableId})`,
        description:
          'DuckDB-backed handle for the data table behind this view. `vacp_handle` reflects the current view state (filters/sort/pagination).',
        data: { table: h.table, tableId },
      });
      edges.push({ from: tableRef, to: h.ref, kind: 'contains' });
    });
  }

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions: args.actions };
}
