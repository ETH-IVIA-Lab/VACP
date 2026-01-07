import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpDemo,
  VacpEdge,
  VacpGraph,
  VacpNode,
  VacpRef,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';

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
   * Optional Vega View API: subscribe to signal changes.
   * Used to keep the VACP runtime timeline in sync with human interactions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addSignalListener?: (name: string, handler: (name: string, value: any) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeSignalListener?: (name: string, handler: (name: string, value: any) => void) => void;
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
  /** Optional demo scripts for debug tooling. */
  demos?: VacpDemo[];
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

  const edges: VacpEdge[] = [];

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
    edges.push({ from: vizRef, to: pref, kind: 'contains' });
  });

  return { version: VACP_SCHEMA_VERSION, nodes, edges, actions };
}

function actionsForParams(options: InstallVacpOnVegaLiteOptions, spec: VegaLiteSpecLike): VacpActionDescriptor[] {
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const actions: VacpActionDescriptor[] = [];

  const hasParam = (spec.params ?? []).some((p) => !p.select);
  const hasSelection = (spec.params ?? []).some((p) => !!p.select);

  if (hasParam) {
    actions.push({
      name: 'vega_lite.set_param',
      description: 'Set a Vega-Lite variable parameter (implemented via Vega view signals).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'VACP ref of the Param node (vacp://.../param/<name>)' },
          value: {},
        },
        required: ['ref', 'value'],
      },
    });
  }

  if (hasSelection) {
    actions.push({
      name: 'vega_lite.clear_selection',
      description: 'Clear a Vega-Lite selection parameter (best-effort; uses Vega signals).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'VACP ref of the Selection node (vacp://.../param/<name>)' },
        },
        required: ['ref'],
      },
    });
  }

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

function tryGetSignal(view: VegaViewLike, name: string): unknown {
  try {
    return view.signal(name);
  } catch {
    return undefined;
  }
}

function trySetSignal(view: VegaViewLike, name: string, value: unknown): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view.signal(name, value as any);
    return true;
  } catch {
    return false;
  }
}

function signalNamesFromView(view: VegaViewLike): string[] {
  if (typeof view.getState !== 'function') return [];
  try {
    const st = view.getState();
    if (!st || typeof st !== 'object') return [];
    const signals = (st as { signals?: unknown }).signals;
    if (!signals || typeof signals !== 'object') return [];
    return Object.keys(signals as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function executeAction(
  view: VegaViewLike,
  call: VacpActionCall,
  helpers: {
    paramByRef: Map<string, { param: VegaLiteParamLike; kind: 'Param' | 'Selection' }>;
    watchedSignalsByParam: Map<string, string[]>;
    allSignals: string[];
  },
): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const ref = typeof params.ref === 'string' ? params.ref : null;

  if (call.name === 'vega_lite.set_param') {
    if (!ref) throw new Error('Missing param ref');
    const meta = helpers.paramByRef.get(ref);
    if (!meta) throw new Error(`Unknown param ref: ${ref}`);
    if (meta.kind !== 'Param') throw new Error(`Param ref is not a variable parameter: ${ref}`);
    const name = meta.param.name;
    if (!name) throw new Error('Missing param name');
    // Vega-Lite variable parameters can be modified via Vega View signals.
    trySetSignal(view, name, params.value);
    await view.runAsync();
    return { set: true, name, ref };
  }

  if (call.name === 'vega_lite.clear_selection') {
    if (!ref) throw new Error('Missing selection ref');
    const meta = helpers.paramByRef.get(ref);
    if (!meta) throw new Error(`Unknown param ref: ${ref}`);
    if (meta.kind !== 'Selection') throw new Error(`Ref is not a selection parameter: ${ref}`);
    const name = meta.param.name;
    if (!name) throw new Error('Missing selection name');

    // Best-effort clearing. Vega-Lite selections compile to several signals;
    // common ones include `${name}_clear` and `${name}_tuple`.
    const clearSig = `${name}_clear`;
    if (helpers.allSignals.includes(clearSig)) {
      trySetSignal(view, clearSig, true);
      await view.runAsync();
      trySetSignal(view, clearSig, false);
      await view.runAsync();
      return { cleared: true, name, ref, via: clearSig };
    }

    const watched = helpers.watchedSignalsByParam.get(name) ?? [name];
    let any = false;
    for (const s of watched) {
      if (!helpers.allSignals.includes(s)) continue;
      if (trySetSignal(view, s, null)) any = true;
    }
    if (!any) {
      // Fall back to trying the param name even if it wasn't in getState().
      any = trySetSignal(view, name, null);
    }
    await view.runAsync();
    return { cleared: true, name, ref, via: any ? 'signals' : 'unknown' };
  }

  if (call.name === 'vega.set_signal') {
    const name = String(params.name ?? '');
    if (!name) throw new Error('Missing signal name');
    trySetSignal(view, name, params.value);
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
  let lastChangeSource: VacpChangeSource = 'human';

  const descriptorsByName = new Map<string, VacpActionDescriptor>();
  actionDescriptors.forEach((desc) => descriptorsByName.set(desc.name, desc));

  const allSignals = signalNamesFromView(view);
  const watchedSignalsByParam = new Map<string, string[]>();
  const paramByRef = new Map<string, { param: VegaLiteParamLike; kind: 'Param' | 'Selection' }>();

  (spec.params ?? []).forEach((p) => {
    const { kind } = classifyParam(p);
    const pref = makeRef({
      appId: options.appId,
      viewId: options.viewId,
      vizId: options.vizId,
      suffix: `/param/${p.name}`,
    });
    paramByRef.set(pref, { param: p, kind });
    if (kind === 'Selection') {
      const matches = allSignals.filter((s) => s === p.name || s.startsWith(`${p.name}_`));
      watchedSignalsByParam.set(p.name, matches.length ? matches : [p.name]);
    } else {
      watchedSignalsByParam.set(p.name, [p.name]);
    }
  });

  descriptorsByName.forEach((desc) => {
    actionRegistry.register(desc, async (params) => {
      const call: VacpActionCall = { callId: crypto.randomUUID(), name: desc.name, params };
      lastChangeSource = 'agent';
      try {
        return await executeAction(view, call, { paramByRef, watchedSignalsByParam, allSignals });
      } finally {
        queueMicrotask(() => {
          lastChangeSource = 'human';
        });
      }
    });
  });

  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });

  const desc = registerVacpApplyStateAction(
    actionRegistry,
    async (state) => {
      const errors: Array<{ ref: string; message: string }> = [];
      let applied = 0;

      for (const [ref, raw] of Object.entries(state)) {
        const meta = paramByRef.get(ref);
        if (!meta) continue;
        try {
          lastChangeSource = 'agent';
          if (meta.kind === 'Param') {
            const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const value = rec.value;
            if (value === undefined) throw new Error('Missing value for Param');
            trySetSignal(view, meta.param.name, value);
            await view.runAsync();
            applied += 1;
            continue;
          }

          // Selection parameters: best-effort set/clear via signals.
          const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
          const signals = rec.signals && typeof rec.signals === 'object' ? (rec.signals as Record<string, unknown>) : null;
          if (!signals || Object.keys(signals).length === 0) {
            await executeAction(
              view,
              { callId: crypto.randomUUID(), name: 'vega_lite.clear_selection', params: { ref } },
              { paramByRef, watchedSignalsByParam, allSignals },
            );
            applied += 1;
            continue;
          }
          let any = false;
          for (const [name, value] of Object.entries(signals)) {
            if (!name) continue;
            if (trySetSignal(view, name, value)) any = true;
          }
          await view.runAsync();
          if (any) applied += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ ref, message });
        } finally {
          queueMicrotask(() => {
            lastChangeSource = 'human';
          });
        }
      }

      return { applied, errors };
    },
    { targetRef: vizRef, description: 'Apply a state map to Vega-Lite params (signals).' },
  );
  actionDescriptors.push(desc);

  const graph = buildGraph({ spec, options, actions: actionDescriptors });
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
        const { kind } = classifyParam(p);
        const watched = watchedSignalsByParam.get(p.name) ?? [p.name];
        const signals: Record<string, unknown> = {};
        watched.forEach((s) => {
          signals[s] = tryGetSignal(view, s);
        });
        state[pref] =
          kind === 'Selection'
            ? { kind, name: p.name, signals }
            : { kind, name: p.name, value: tryGetSignal(view, p.name), bind: p.bind };
      });

      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state };
    },
  };

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: actionRegistry,
    demos: options.demos,
    globalKey: options.globalKey,
  });

  // Keep the runtime timeline updated on human-driven param changes (signals).
  // This enables seamless human/agent handoff and makes time-travel debugging
  // meaningful.
  if (typeof view.addSignalListener === 'function') {
    // Human input (brush/drag) can emit many intermediate signal updates;
    // coalesce them into a timeline suitable for inspection.
    let pendingTimer: number | null = null;
    const onSignal = () => {
      if (pendingTimer !== null) return;
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null;
        if (typeof bridge.refresh === 'function') {
          void bridge.refresh({ source: lastChangeSource, message: 'signal change' }).catch(() => {
            // ignore instrumentation failures
          });
        }
      }, 120);
    };

    const watched = new Set<string>();
    (spec.params ?? []).forEach((p) => {
      (watchedSignalsByParam.get(p.name) ?? [p.name]).forEach((s) => watched.add(s));
    });
    watched.forEach((s) => view.addSignalListener?.(s, onSignal));
  }
}
