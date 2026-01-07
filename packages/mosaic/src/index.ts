import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpGraph,
  VacpNode,
  VacpRef,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { createVacpWindowBridge, installVacpWindowBridge, VacpActionRegistry } from '@vacp/gateway';

/**
 * Mosaic/vgplot provider (project concepts).
 *
 * Why Mosaic-first?
 * - Observable Plot is a renderer; Mosaic/vgplot is a semantic runtime.
 * - vgplot knows: data sources, field encodings, selections/params, interactors.
 * - Therefore vgplot is the right level to expose stable refs + meaningful actions.
 *
 * What this provider emits:
 * - canonical VACP graph embedded into the SVG (metadata)
 * - DOM/SVG annotations for discoverability + fallback extraction
 * - an in-page bridge (`window.__vacp`) for fast, stable MCP access
 *
 * What it avoids by design:
 * - per-datum annotation for large views ("DataLayer explosion")
 */
/**
 * Minimal structural types for vgplot Plot/Mark/Interactor objects.
 * This keeps @vacp/mosaic usable even if Mosaic types are not installed.
 */
export interface VgplotMarkLike {
  type?: string;
  index?: number;
  sourceTable?: () => string | null;
  channels?: Array<{ channel: string; as?: string; field?: unknown }>;
}

export interface VgplotInteractorLike {
  /** Used for stable IDs and branching logic. */
  constructor: { name: string };
  /** Most vgplot interactors expose .value and update a .selection. */
  value?: unknown;
  selection?: { value?: unknown };
  /** Called by vgplot after Plot.plot has produced an SVG. */
  init?: (svg: SVGElement) => unknown | Promise<unknown>;
}

export interface VgplotPlotLike {
  element?: HTMLElement;
  marks: VgplotMarkLike[];
  interactors: VgplotInteractorLike[];
  setAttribute?: (name: string, value: unknown, options?: { silent?: boolean }) => boolean;
  update?: (...args: unknown[]) => unknown;
  getAttribute?: (name: string) => unknown;
}

export interface InstallVacpOnVgplotOptions {
  appId: string;
  viewId: string;
  plotId: string;
  /** Human-facing metadata. */
  title?: string;
  description?: string;
  /** Annotate the outer host element too (if present). */
  annotateHostElement?: boolean;
  /** Global key for `window.__vacp`. */
  globalKey?: string;
}

function makeRef({
  appId,
  viewId,
  plotId,
  suffix,
}: {
  appId: string;
  viewId: string;
  plotId: string;
  suffix: string;
}): VacpRef {
  return `vacp://${appId}/${viewId}/${plotId}${suffix}` as VacpRef;
}

/**
 * Build a canonical VACP graph from vgplot's semantic objects.
 *
 * The goal is stable identity + meaning. Raw data should be exposed via handles
 * and summaries rather than embedding every point.
 */
function buildGraph({
  plot,
  options,
  actions,
}: {
  plot: VgplotPlotLike;
  options: InstallVacpOnVgplotOptions;
  actions: VacpActionDescriptor[];
}): VacpGraph {
  const plotRef = makeRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '' });

  const safe = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };

  const nodes: VacpNode[] = [
    {
      ref: plotRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: options.title,
      description: options.description,
      data: {
        width: safe(() => plot.getAttribute?.('width')),
        height: safe(() => plot.getAttribute?.('height')),
      },
    },
  ];

  for (const mark of plot.marks) {
    const idx = typeof mark.index === 'number' ? mark.index : undefined;
    const markRef = makeRef({
      appId: options.appId,
      viewId: options.viewId,
      plotId: options.plotId,
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
        table: safe(() => mark.sourceTable?.() ?? undefined),
      },
    });
  }

  // For now keep edges minimal; consumers can traverse by ref prefixes.
  return { version: VACP_SCHEMA_VERSION, nodes, edges: [], actions };
}

function describeInteractorActions({
  options,
  interactor,
  interactorId,
}: {
  options: InstallVacpOnVgplotOptions;
  interactor: VgplotInteractorLike;
  interactorId: string;
}): VacpActionDescriptor[] {
  /**
   * Actions are defined per interactor, keyed by a stable `interactorId`.
   *
   * We intentionally expose domain-based parameters (x0/x1/y0/y1), because those
   * are meaningful to agents and stable across resizes and rerenders.
   */
  const name = interactor.constructor?.name ?? 'Interactor';
  const baseTarget = makeRef({
    appId: options.appId,
    viewId: options.viewId,
    plotId: options.plotId,
    suffix: `/interactor/${interactorId}`,
  });

  // Minimal set: Interval1D + Interval2D based on class name (as in vgplot).
  if (name === 'Interval1D') {
    return [
      {
        name: 'mosaic.set_interval_1d',
        description: 'Set a 1D interval selection on a vgplot plot.',
        targetRef: baseTarget,
        parameters: {
          type: 'object',
          properties: {
            interactorId: { type: 'string' },
            min: { type: 'number' },
            max: { type: 'number' },
          },
          required: ['interactorId', 'min', 'max'],
        },
      },
      {
        name: 'mosaic.clear_interval_1d',
        description: 'Clear a 1D interval selection on a vgplot plot.',
        targetRef: baseTarget,
        parameters: {
          type: 'object',
          properties: { interactorId: { type: 'string' } },
          required: ['interactorId'],
        },
      },
    ];
  }

  if (name === 'Interval2D') {
    return [
      {
        name: 'mosaic.set_interval_2d',
        description: 'Set a 2D interval selection (x/y) on a vgplot plot.',
        targetRef: baseTarget,
        parameters: {
          type: 'object',
          properties: {
            interactorId: { type: 'string' },
            x0: { type: 'number' },
            x1: { type: 'number' },
            y0: { type: 'number' },
            y1: { type: 'number' },
          },
          required: ['interactorId', 'x0', 'x1', 'y0', 'y1'],
        },
      },
      {
        name: 'mosaic.clear_interval_2d',
        description: 'Clear a 2D interval selection (x/y) on a vgplot plot.',
        targetRef: baseTarget,
        parameters: {
          type: 'object',
          properties: { interactorId: { type: 'string' } },
          required: ['interactorId'],
        },
      },
    ];
  }

  return [];
}

async function executeMosaicAction(plot: VgplotPlotLike, call: VacpActionCall): Promise<unknown> {
  /**
   * Execution bridges the agent request to the app's semantic runtime:
   * - validate params
   * - update interactor/selection state in domain units
   *
   * This keeps the agent out of pixel/DOM-event land.
   */
  const params = (call.params ?? {}) as Record<string, unknown>;
  const interactorId = String(params.interactorId ?? '');
  const interactor = plot.interactors[Number(interactorId)];
  if (!interactor) throw new Error(`Unknown interactorId: ${interactorId}`);

  const ctorName = interactor.constructor?.name ?? 'Interactor';

  if (call.name === 'mosaic.clear_interval_1d' && ctorName === 'Interval1D') {
    // Publish null-equivalent by calling publish if present; else set value undefined.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyI = interactor as any;
    if (typeof anyI.publish === 'function') anyI.publish(null);
    else anyI.value = undefined;
    return { cleared: true };
  }

  if (call.name === 'mosaic.clear_interval_2d' && ctorName === 'Interval2D') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyI = interactor as any;
    if (typeof anyI.publish === 'function') anyI.publish(null);
    else anyI.value = undefined;
    return { cleared: true };
  }

  if (call.name === 'mosaic.set_interval_1d' && ctorName === 'Interval1D') {
    const min = Number(params.min);
    const max = Number(params.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('min/max must be numbers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyI = interactor as any;
    anyI.value = [min, max];
    if (anyI.g && anyI.brush && anyI.scale) {
      const px = [min, max].map((v: number) => anyI.scale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, px);
    }
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause([min, max]));
    }
    return { set: true };
  }

  if (call.name === 'mosaic.set_interval_2d' && ctorName === 'Interval2D') {
    const x0 = Number(params.x0);
    const x1 = Number(params.x1);
    const y0 = Number(params.y0);
    const y1 = Number(params.y1);
    if (![x0, x1, y0, y1].every(Number.isFinite)) throw new Error('x0/x1/y0/y1 must be numbers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyI = interactor as any;
    anyI.value = [
      [x0, x1],
      [y0, y1],
    ];
    if (anyI.g && anyI.brush && anyI.xscale && anyI.yscale) {
      const px = [x0, x1].map((v: number) => anyI.xscale.apply(v));
      const py = [y0, y1].map((v: number) => anyI.yscale.apply(v));
      anyI.g.call(anyI.brush.moveSilent, [
        [Math.min(...px), Math.min(...py)],
        [Math.max(...px), Math.max(...py)],
      ]);
    }
    if (typeof anyI.selection?.update === 'function' && typeof anyI.clause === 'function') {
      anyI.selection.update(anyI.clause(anyI.value));
    }
    return { set: true };
  }

  throw new Error(`Unsupported action for interactor ${ctorName}: ${call.name}`);
}

export function installVacpOnVgplot(plot: VgplotPlotLike, svg: SVGElement, options: InstallVacpOnVgplotOptions): void {
  const actionRegistry = new VacpActionRegistry();
  let lastChangeSource: VacpChangeSource = 'human';

  /**
   * Provider responsibility:
   * - define stable action descriptors (discovery)
   * - register validated handlers (control)
   * - expose current values as state snapshots (observation)
   */
  // Produce stable, discoverable action descriptors for interactors.
  const actionDescriptors: VacpActionDescriptor[] = [];
  plot.interactors.forEach((interactor, i) => {
    const interactorId = String(i);
    actionDescriptors.push(...describeInteractorActions({ options, interactor, interactorId }));
  });

  const actionByName = new Map<string, VacpActionDescriptor>();
  for (const desc of actionDescriptors) {
    if (!actionByName.has(desc.name)) actionByName.set(desc.name, desc);
  }

  for (const desc of actionByName.values()) {
    actionRegistry.register(desc, async (params) => {
      // bridge format uses VacpActionCall; for registry we only get params.
      const call: VacpActionCall = {
        callId: crypto.randomUUID(),
        name: desc.name,
        params,
      };
      lastChangeSource = 'agent';
      try {
        return await executeMosaicAction(plot, call);
      } finally {
        queueMicrotask(() => {
          lastChangeSource = 'human';
        });
      }
    });
  }

  const graph = buildGraph({ plot, options, actions: actionDescriptors });

  const plotRef = makeRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '' });

  const applyAnnotationsToSvg = (svgEl: SVGElement): void => {
    /**
     * DOM/SVG annotations are a convenience and a fallback surface.
     * The primary path for the MCP server is the window bridge installed below.
     *
     * Important: vgplot interactors can mutate the SVG after initial creation
     * (e.g., to install brushes). Keep this operation idempotent so it can be
     * re-applied after those mutations without accumulating duplicate metadata.
     */

    // Annotate the root SVG element for DOM-based fallbacks.
    applyVacpAttributes(svgEl, {
      ref: plotRef,
      layer: 'VisualizationLayer',
      kind: 'Visualization',
      title: options.title,
      description: options.description,
      data: { plotId: options.plotId },
    });
    applyVacpInteractionAttributes(svgEl, {
      targetRef: plotRef,
      layer: 'VisualizationLayer',
      description: 'Programmatic interactions for this Mosaic/vgplot visualization.',
      actions: actionDescriptors,
    });

    // Annotate mark groups if vgplot has applied data-index to them.
    svgEl.querySelectorAll('[data-index]').forEach((el) => {
      const idx = el.getAttribute('data-index') ?? 'unknown';
      const markRef = makeRef({
        appId: options.appId,
        viewId: options.viewId,
        plotId: options.plotId,
        suffix: `/mark/${idx}`,
      });
      applyVacpAttributes(el, {
        ref: markRef,
        layer: 'VisualizationLayer',
        kind: 'Mark',
        title: `mark ${idx}`,
        description: 'vgplot mark output group',
        data: { index: idx },
      });
    });

    embedVacpGraphInSvg(svgEl, graph);
  };

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph,
    }),
    getState: async (): Promise<VacpStateSnapshot> => {
      const state: Record<VacpRef, unknown> = {};
      plot.interactors.forEach((interactor, i) => {
        const interactorRef = makeRef({
          appId: options.appId,
          viewId: options.viewId,
          plotId: options.plotId,
          suffix: `/interactor/${i}`,
        });
        const selectionValue =
          (
            interactor as unknown as {
              selection?: {
                value?: unknown;
              };
            }
          ).selection?.value ?? undefined;
        state[interactorRef] = {
          kind: interactor.constructor?.name ?? 'Interactor',
          value: (interactor as { value?: unknown }).value,
          selectionValue,
        };
      });
      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state };
    },
  };

  const bridge = createVacpWindowBridge({ snapshots, actions: actionRegistry });
  installVacpWindowBridge(bridge, { globalKey: options.globalKey });

  const notifyRuntime = (message: string) => {
    if (typeof bridge.refresh !== 'function') return;
    void bridge.refresh({ source: lastChangeSource, message });
  };

  /**
   * Hook into the plot lifecycle.
   *
   * vgplot interactors can install UI affordances (brushes, listeners) in their
   * `init(svg)` method. Some implementations mutate the SVG tree in a way that
   * can drop appended `<metadata>` nodes. We patch `init` so annotations are
   * re-applied after the interactor has finished its SVG work.
   */
  plot.interactors.forEach((it) => {
    const origInit = it.init;
    it.init = async (svgEl: SVGElement) => {
      const res = origInit ? await origInit.call(it, svgEl) : undefined;
      applyAnnotationsToSvg(svgEl);
      notifyRuntime('interactor.init');
      return res;
    };

    // Human interactions often publish via selection.update(). Wrap it to keep
    // VACP's runtime timeline in sync with the app state.
    const anyIt = it as unknown as { selection?: { update?: (...args: unknown[]) => unknown } };
    const sel = anyIt.selection;
    if (sel && typeof sel.update === 'function' && !(sel.update as unknown as { __vacpWrapped?: boolean }).__vacpWrapped) {
      const orig = sel.update;
      const wrapped = (...args: unknown[]) => {
        const out = orig.apply(sel, args);
        queueMicrotask(() => notifyRuntime('selection.update'));
        return out;
      };
      (wrapped as unknown as { __vacpWrapped?: boolean }).__vacpWrapped = true;
      sel.update = wrapped;
    }
  });

  // Apply annotations to the currently rendered SVG as well.
  applyAnnotationsToSvg(svg);

  /**
   * Some vgplot configurations replace the `<svg>` element during or shortly
   * after initialization. Keep the fallback surface stable by re-applying the
   * annotations to the latest SVG under the same host container.
   */
  const anyPlot = plot as unknown as { __vacpObserver?: MutationObserver };
  anyPlot.__vacpObserver?.disconnect();
  const host = svg.closest('.plot') ?? svg.parentElement ?? plot.element ?? null;
  if (host) {
    const anyPlot2 = plot as unknown as { __vacpSvgObserver?: MutationObserver };

    const attachSvgObserver = (svgEl: SVGElement) => {
      anyPlot2.__vacpSvgObserver?.disconnect();
      let inApply = false;
      const svgObs = new MutationObserver(() => {
        if (inApply) return;
        // Some render pipelines reset `svg.innerHTML` or rebuild the SVG,
        // which can drop both metadata and custom attributes.
        const needs =
          !svgEl.querySelector('metadata[type="application/vacp+json"]') ||
          !svgEl.getAttribute('data-vacp-ref') ||
          !svgEl.getAttribute('data-interaction-vacp-actions');
        if (needs) {
          inApply = true;
          try {
            applyAnnotationsToSvg(svgEl);
          } finally {
            inApply = false;
          }
        }
      });
      svgObs.observe(svgEl, { childList: true, attributes: true });
      anyPlot2.__vacpSvgObserver = svgObs;
    };

    let lastSvg = svg;
    attachSvgObserver(lastSvg);

    const obs = new MutationObserver(() => {
      const next = host.querySelector('svg');
      if (!next || next === lastSvg) return;
      lastSvg = next;
      applyAnnotationsToSvg(next);
      attachSvgObserver(next);
    });
    obs.observe(host, { childList: true, subtree: true });
    anyPlot.__vacpObserver = obs;
  }

  if (options.annotateHostElement && plot.element) {
    applyVacpAttributes(plot.element, {
      ref: makeRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '/host' }),
      layer: 'ViewLayer',
      kind: 'InteractionTarget',
      description: 'Host element containing the vgplot visualization and associated legends.',
      data: { plotId: options.plotId },
    });
  }

  // Capture an initial snapshot so tooling sees the graph immediately.
  notifyRuntime('installed');
}
