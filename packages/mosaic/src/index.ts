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

  const nodes: VacpNode[] = [
    {
      ref: plotRef,
      kind: 'Visualization',
      layer: 'VisualizationLayer',
      title: options.title,
      description: options.description,
      data: {
        width: plot.getAttribute?.('width'),
        height: plot.getAttribute?.('height'),
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
        table: mark.sourceTable?.() ?? undefined,
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
      return executeMosaicAction(plot, call);
    });
  }

  const graph = buildGraph({ plot, options, actions: actionDescriptors });

  /**
   * DOM/SVG annotations are a convenience and a fallback surface.
   * The primary path for the MCP server is the window bridge installed below.
   */
  // Annotate the root SVG element for DOM-based fallbacks.
  const plotRef = makeRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '' });
  applyVacpAttributes(svg, {
    ref: plotRef,
    layer: 'VisualizationLayer',
    kind: 'Visualization',
    title: options.title,
    description: options.description,
    data: { plotId: options.plotId },
  });
  applyVacpInteractionAttributes(svg, {
    targetRef: plotRef,
    layer: 'VisualizationLayer',
    description: 'Programmatic interactions for this Mosaic/vgplot visualization.',
    actions: actionDescriptors,
  });

  // Annotate mark groups if vgplot has applied data-index to them.
  svg.querySelectorAll('[data-index]').forEach((el) => {
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

  embedVacpGraphInSvg(svg, graph);

  if (options.annotateHostElement && plot.element) {
    applyVacpAttributes(plot.element, {
      ref: makeRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '/host' }),
      layer: 'ViewLayer',
      kind: 'InteractionTarget',
      description: 'Host element containing the vgplot visualization and associated legends.',
      data: { plotId: options.plotId },
    });
  }

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
        state[interactorRef] = {
          kind: interactor.constructor?.name ?? 'Interactor',
          value: (interactor as { value?: unknown }).value,
          selection: (interactor as { selection?: unknown }).selection,
        };
      });
      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state };
    },
  };

  const bridge = createVacpWindowBridge({ snapshots, actions: actionRegistry });
  installVacpWindowBridge(bridge, { globalKey: options.globalKey });
}
