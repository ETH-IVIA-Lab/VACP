import type { VacpActionDescriptor, VacpEdge, VacpGraph, VacpNode, VacpRef } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import { collectVegaLiteParams } from './params';
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
  dataHandles?: Array<{ ref: VacpRef; title?: string; description?: string; data?: Record<string, unknown> }>;
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

  collectVegaLiteParams(args.spec).forEach((p) => {
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

  (args.dataHandles ?? []).forEach((h) => {
    nodes.push({
      ref: h.ref,
      kind: 'DataHandle',
      layer: 'DataLayer',
      title: h.title ?? 'data (DuckDB handle)',
      description:
        h.description ??
        'DuckDB-backed DataHandle for this Vega-Lite view. `vacp_handle` is the selected subset (or all rows if empty).',
      data: h.data,
    });
    edges.push({ from: vizRef, to: h.ref, kind: 'contains' });
  });

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions: args.actions };
}
