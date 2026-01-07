import type { VacpActionDescriptor, VacpEdge, VacpGraph, VacpNode, VacpRef } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import { makeRef } from './refs';
import type { InstallVacpOnVegaLiteOptions, VegaLiteParamLike, VegaLiteSpecLike } from './types';

function classifyParam(p: VegaLiteParamLike): { kind: 'Param' | 'Selection'; details: Record<string, unknown> } {
  if (p.select) {
    return { kind: 'Selection', details: { select: p.select, bind: p.bind } };
  }
  return { kind: 'Param', details: { bind: p.bind } };
}

export function buildGraph(args: {
  spec: VegaLiteSpecLike;
  options: InstallVacpOnVegaLiteOptions;
  actions: VacpActionDescriptor[];
  dataHandle?: { ref: VacpRef; title?: string; description?: string; data?: Record<string, unknown> };
}): VacpGraph {
  const vizRef = makeRef({
    appId: args.options.appId,
    viewId: args.options.viewId,
    vizId: args.options.vizId,
    suffix: '',
  });
  const nodes: VacpNode[] = [
    {
      ref: vizRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: args.options.title,
      description: args.options.description,
      data: { provider: 'vega-lite' },
    },
  ];

  const edges: VacpEdge[] = [];

  (args.spec.params ?? []).forEach((p) => {
    const { kind, details } = classifyParam(p);
    const pref = makeRef({
      appId: args.options.appId,
      viewId: args.options.viewId,
      vizId: args.options.vizId,
      suffix: `/param/${p.name}`,
    });
    nodes.push({
      ref: pref,
      kind,
      layer: kind === 'Selection' ? 'InteractionFeedbackLayer' : 'ConfigLayer',
      title: p.name,
      description: kind === 'Selection' ? 'Vega-Lite selection parameter' : 'Vega-Lite variable parameter',
      data: details,
    });
    edges.push({ from: vizRef, to: pref, kind: 'contains' });
  });

  if (args.dataHandle) {
    nodes.push({
      ref: args.dataHandle.ref,
      kind: 'DataHandle',
      layer: 'DataLayer',
      title: args.dataHandle.title ?? 'data (DuckDB handle)',
      description:
        args.dataHandle.description ??
        'DuckDB-backed DataHandle for this Vega-Lite view. `vacp_handle` is the selected subset (or all rows if empty).',
      data: args.dataHandle.data,
    });
    edges.push({ from: vizRef, to: args.dataHandle.ref, kind: 'contains' });
  }

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions: args.actions };
}
