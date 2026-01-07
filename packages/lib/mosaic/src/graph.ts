import type { VacpActionDescriptor, VacpEdge, VacpGraph, VacpNode, VacpRef } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import type { CollectedInput } from './inputs';
import { makePlotRef, makeViewRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike } from './types';

export function buildDashboardGraph(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  inputs: CollectedInput[];
  options: InstallVacpOnVgplotDashboardOptions;
  actions: VacpActionDescriptor[];
  dataHandles?: Array<{ ref: VacpRef; plotId: string; table?: string }>;
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

    const handles = (args.dataHandles ?? []).filter((h) => h.plotId === plotId);
    handles.forEach((h) => {
      nodes.push({
        ref: h.ref,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: 'data (DuckDB handle)',
        description:
          'DuckDB-backed handle for the data table behind this plot. `vacp_handle` is the selected subset (or all rows if empty).',
        data: { table: h.table, plotId },
      });
      edges.push({ from: plotRef, to: h.ref, kind: 'contains' });
    });
  }

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions: args.actions };
}
