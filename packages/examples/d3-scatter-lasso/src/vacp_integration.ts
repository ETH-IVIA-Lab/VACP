import type {
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpDemo,
  VacpGraph,
  VacpRef,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';

export type DomainPoint = { x: number; y: number };

function makeRef(parts: string[]): VacpRef {
  return `vacp://${parts.join('/')}` as VacpRef;
}

export function installVacpForD3ScatterLasso(args: {
  svg: SVGSVGElement;
  appId: string;
  viewId: string;
  vizId: string;
  width: number;
  height: number;
  title: string;
  globalKey: string;
  demos: VacpDemo[];
  getLassoPolygon: () => DomainPoint[] | null;
  setLassoPolygon: (poly: DomainPoint[] | null) => void;
  getSelectedCount: () => number;
  clearSelection: () => void;
}) {
  const vizRef = makeRef([args.appId, args.viewId, args.vizId]);
  const pointsRef = makeRef([args.appId, args.viewId, args.vizId, 'mark', 'points']);
  const lassoRef = makeRef([args.appId, args.viewId, args.vizId, 'selection', 'lasso']);

  const actions: VacpActionDescriptor[] = [
    {
      name: 'vanilla.set_lasso_polygon',
      description: 'Set the lasso selection polygon in data (domain) coordinates.',
      targetRef: lassoRef,
      parameters: {
        type: 'object',
        properties: {
          points: {
            type: 'array',
            items: {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
            },
          },
        },
        required: ['points'],
      },
    },
    {
      name: 'vanilla.clear_lasso',
      description: 'Clear the current lasso selection.',
      targetRef: lassoRef,
      parameters: { type: 'object', properties: {} },
    },
  ];

  const registry = new VacpActionRegistry();

  const graph: VacpGraph = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      {
        ref: vizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: args.title,
        data: { width: args.width, height: args.height },
      },
      { ref: pointsRef, kind: 'Mark', layer: 'VisualizationLayer', title: 'points', description: 'scatter points' },
      {
        ref: lassoRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'lasso',
        description: 'freeform polygon selection',
      },
    ],
    edges: [
      { from: vizRef, to: pointsRef, kind: 'contains' },
      { from: vizRef, to: lassoRef, kind: 'contains' },
    ],
    actions,
  };

  registry.register(actions[0], async (params) => {
    const p = (params ?? {}) as { points?: Array<{ x: unknown; y: unknown }> };
    const pts = Array.isArray(p.points) ? p.points : [];
    const poly: DomainPoint[] = pts
      .map((d) => ({ x: Number(d.x), y: Number(d.y) }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    args.setLassoPolygon(poly.length >= 3 ? poly : null);
    return { ok: true, selectedCount: args.getSelectedCount() };
  });

  registry.register(actions[1], async () => {
    args.clearSelection();
    return { ok: true };
  });

  const applyStateDesc = registerVacpApplyStateAction(
    registry,
    async (state) => {
      const errors: Array<{ ref: string; message: string }> = [];
      const raw = state[lassoRef];
      if (raw === undefined) return { applied: 0, errors };
      const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const poly = rec.polygon;
      try {
        if (poly === null || poly === undefined) {
          args.clearSelection();
          return { applied: 1, errors };
        }
        if (!Array.isArray(poly)) throw new Error('Expected polygon to be an array of {x,y}');
        const pts = poly
          .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
          .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        args.setLassoPolygon(pts.length >= 3 ? pts : null);
        return { applied: 1, errors };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ ref: lassoRef, message });
        return { applied: 0, errors };
      }
    },
    { targetRef: lassoRef, description: 'Apply lasso selection state (polygon) to the live D3 plot.' },
  );
  actions.push(applyStateDesc);

  applyVacpAttributes(args.svg, { ref: vizRef, layer: 'VisualizationLayer', kind: 'Visualization', title: args.title });
  applyVacpInteractionAttributes(args.svg, {
    targetRef: vizRef,
    layer: 'VisualizationLayer',
    description: 'Programmatic interactions for this D3 visualization.',
    actions,
  });
  embedVacpGraphInSvg(args.svg, graph);

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph,
    }),
    getState: async (): Promise<VacpStateSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      state: {
        [lassoRef]: {
          kind: 'Selection',
          polygon: args.getLassoPolygon() ?? null,
          selectedCount: args.getSelectedCount(),
        },
      },
    }),
  };

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: registry,
    demos: args.demos,
    globalKey: args.globalKey,
  });

  return { bridge, vizRef, pointsRef, lassoRef, actions, graph };
}
