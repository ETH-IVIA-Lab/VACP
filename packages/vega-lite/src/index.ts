import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpGraph,
  VacpNode,
  VacpRef,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { createVacpWindowBridge, installVacpWindowBridge, VacpActionRegistry } from '@vacp/gateway';

/**
 * Vega-Lite provider (project concepts).
 *
 * Vega-Lite defines *parameters* (`params`) for interactivity:
 * - variable parameters (scalars) can be bound to inputs or modified via Vega view signals
 * - selection parameters define interactive selections (point/interval) and compile to signals/state
 *
 * For VACP, parameters are the natural first-class control/state surface:
 * - Discovery: list params and what kind they are (variable vs selection)
 * - State: current param values (from signals)
 * - Control: set/clear param values by name (domain-based, not pixel-based)
 *
 * We intentionally keep this provider dependency-light by using structural types
 * instead of importing Vega/Vega-Lite at build time.
 */

export interface VegaViewLike {
  /**
   * Vega View API: read or set a signal.
   * - signal(name) -> current value
   * - signal(name, value) -> sets value (requires run/runAsync to apply)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal(name: string, value?: any): any;
  runAsync(): Promise<unknown>;
  /**
   * Optional Vega View API: list available signal names.
   * (Not guaranteed; provider will degrade gracefully.)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getState?: () => any;
}

export type VegaLiteParamLike = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bind?: any;
};

export interface VegaLiteSpecLike {
  // Vega-Lite uses `params` for both variable and selection parameters.
  params?: VegaLiteParamLike[];
  // Optional metadata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface InstallVacpOnVegaLiteOptions {
  appId: string;
  viewId: string;
  vizId: string;
  title?: string;
  description?: string;
  globalKey?: string;
  /**
   * If true, include a debugging action that allows setting any signal by name.
   * This is powerful but should be used carefully in production UIs.
   */
  includeSetSignalAction?: boolean;
}

function makeRef({
  appId,
  viewId,
  vizId,
  suffix,
}: {
  appId: string;
  viewId: string;
  vizId: string;
  suffix: string;
}): VacpRef {
  return `vacp://${appId}/${viewId}/${vizId}${suffix}` as VacpRef;
}

function classifyParam(p: VegaLiteParamLike): { kind: 'Param' | 'Selection'; details: Record<string, unknown> } {
  if (p.select) {
    return { kind: 'Selection', details: { select: p.select, bind: p.bind } };
  }
  return { kind: 'Param', details: { bind: p.bind } };
}

function buildGraph({
  spec,
  options,
  actions,
}: {
  spec: VegaLiteSpecLike;
  options: InstallVacpOnVegaLiteOptions;
  actions: VacpActionDescriptor[];
}): VacpGraph {
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const nodes: VacpNode[] = [
    {
      ref: vizRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: options.title,
      description: options.description,
      data: {
        provider: 'vega-lite',
      },
    },
  ];

  (spec.params ?? []).forEach((p) => {
    const { kind, details } = classifyParam(p);
    const pref = makeRef({
      appId: options.appId,
      viewId: options.viewId,
      vizId: options.vizId,
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
  });

  return { version: VACP_SCHEMA_VERSION, nodes, edges: [], actions };
}

function actionsForParams(options: InstallVacpOnVegaLiteOptions, spec: VegaLiteSpecLike): VacpActionDescriptor[] {
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const actions: VacpActionDescriptor[] = [];

  (spec.params ?? []).forEach((p) => {
    const { kind } = classifyParam(p);
    const targetRef = makeRef({
      appId: options.appId,
      viewId: options.viewId,
      vizId: options.vizId,
      suffix: `/param/${p.name}`,
    });

    // Variable params: set directly.
    actions.push({
      name: 'vega_lite.set_param',
      description: 'Set a Vega-Lite parameter by name (implemented via Vega view signals).',
      targetRef,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', const: p.name },
          value: {},
        },
        required: ['name', 'value'],
      },
    });

    // Selection params: clearing is commonly useful even if setting is complex.
    if (kind === 'Selection') {
      actions.push({
        name: 'vega_lite.clear_param',
        description: 'Clear a Vega-Lite selection parameter (best-effort: sets the backing signal to null).',
        targetRef,
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', const: p.name },
          },
          required: ['name'],
        },
      });
    }
  });

  // Debugging escape hatch: set any signal.
  if (options.includeSetSignalAction) {
    actions.push({
      name: 'vega.set_signal',
      description: 'Set an arbitrary Vega signal by name (debugging; powerful).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: {},
        },
        required: ['name', 'value'],
      },
    });
  }

  return actions;
}

async function executeAction(view: VegaViewLike, call: VacpActionCall): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;

  if (call.name === 'vega_lite.set_param') {
    const name = String(params.name ?? '');
    if (!name) throw new Error('Missing param name');
    // Vega-Lite variable parameters can be modified via Vega view signals.
    // See: https://vega.github.io/vega/docs/api/view/#signals
    view.signal(name, params.value);
    await view.runAsync();
    return { set: true, name };
  }

  if (call.name === 'vega_lite.clear_param') {
    const name = String(params.name ?? '');
    if (!name) throw new Error('Missing param name');
    view.signal(name, null);
    await view.runAsync();
    return { cleared: true, name };
  }

  if (call.name === 'vega.set_signal') {
    const name = String(params.name ?? '');
    if (!name) throw new Error('Missing signal name');
    view.signal(name, params.value);
    await view.runAsync();
    return { set: true, name };
  }

  throw new Error(`Unsupported action: ${call.name}`);
}

function findRenderedSvg(root: Element): SVGElement | null {
  return root.querySelector('svg');
}

export function installVacpOnVegaLiteView({
  root,
  view,
  spec,
  options,
}: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  options: InstallVacpOnVegaLiteOptions;
}): void {
  const actionRegistry = new VacpActionRegistry();
  const actionDescriptors = actionsForParams(options, spec);

  const actionByName = new Map<string, VacpActionDescriptor>();
  actionDescriptors.forEach((desc) => {
    if (!actionByName.has(desc.name)) actionByName.set(desc.name, desc);
  });

  actionByName.forEach((desc) => {
    actionRegistry.register(desc, async (params) => {
      const call: VacpActionCall = { callId: crypto.randomUUID(), name: desc.name, params };
      return executeAction(view, call);
    });
  });

  const graph = buildGraph({ spec, options, actions: actionDescriptors });

  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  applyVacpAttributes(root, {
    ref: vizRef,
    layer: 'VisualizationLayer',
    kind: 'Visualization',
    title: options.title,
    description: options.description,
    data: { provider: 'vega-lite' },
  });
  applyVacpInteractionAttributes(root, {
    targetRef: vizRef,
    layer: 'VisualizationLayer',
    description: 'Programmatic interactions for this Vega-Lite visualization.',
    actions: actionDescriptors,
  });

  // If Vega is rendering to SVG, embed the canonical graph as metadata.
  const svg = findRenderedSvg(root);
  if (svg) embedVacpGraphInSvg(svg, graph);

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph,
    }),
    getState: async (): Promise<VacpStateSnapshot> => {
      const state: Record<VacpRef, unknown> = {};

      (spec.params ?? []).forEach((p) => {
        const pref = makeRef({
          appId: options.appId,
          viewId: options.viewId,
          vizId: options.vizId,
          suffix: `/param/${p.name}`,
        });
        state[pref] = { name: p.name, value: view.signal(p.name) };
      });

      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state };
    },
  };

  const bridge = createVacpWindowBridge({ snapshots, actions: actionRegistry });
  installVacpWindowBridge(bridge, { globalKey: options.globalKey });
}
