import type { VacpActionDescriptor, VacpEdge, VacpGraph, VacpNode, VacpRef } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { makePlotRef, makeViewRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike, VgplotTableLike } from './types';

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
      data: { provider: 'mosaic/vgplot' },
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
      description: `Mosaic input widget (${input.meta.kind})`,
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

    for (const mark of plot.marks) {
      const idx = typeof mark.index === 'number' ? mark.index : undefined;
      const markRef = makePlotRef({
        appId: args.options.appId,
        viewId: args.options.viewId,
        plotId,
        suffix: `/mark/${idx ?? 'unknown'}`,
      });
      nodes.push({
        ref: markRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: mark.type ?? 'mark',
        description: 'vgplot mark',
        data: {
          type: mark.type,
          index: idx,
          table: (() => {
            try {
              return mark.sourceTable?.() ?? undefined;
            } catch {
              return undefined;
            }
          })(),
          plotId,
        },
      });
      edges.push({ from: plotRef, to: markRef, kind: 'contains' });
    }

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
    const tableRef = makePlotRef({ appId: args.options.appId, viewId: args.options.viewId, plotId: tableId, suffix: '' });
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
