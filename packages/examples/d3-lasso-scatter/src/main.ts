import type {
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpGraph,
  VacpRef,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { installVacpRuntimeBridge, registerVacpDebugApplyStateAction, VacpActionRegistry } from '@vacp/gateway';
import { installVacpDebugUi } from '@vacp/debug-ui';
import * as d3 from 'd3';

type Point = { id: string; x: number; y: number };
type DomainPoint = { x: number; y: number };

function makeRef(parts: string[]): VacpRef {
  return `vacp://${parts.join('/')}` as VacpRef;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function makePoints(n = 250): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      id: `p${i}`,
      x: Math.random() * 100,
      y: Math.random() * 100,
    });
  }
  return pts;
}

function main() {
  const plotRoot = document.querySelector<HTMLDivElement>('#plot');
  const diagramEl = document.querySelector<HTMLPreElement>('#diagram');
  const stateEl = document.querySelector<HTMLPreElement>('#state');
  const checksEl = document.querySelector<HTMLDivElement>('#checks');
  const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh');
  const demoSetBtn = document.querySelector<HTMLButtonElement>('#demo-set');
  const demoClearBtn = document.querySelector<HTMLButtonElement>('#demo-clear');
  if (!plotRoot || !diagramEl || !stateEl || !checksEl || !refreshBtn || !demoSetBtn || !demoClearBtn) {
    throw new Error('Missing root elements');
  }
  const statePre = stateEl;
  const diagramPre = diagramEl;
  const checksDiv = checksEl;

  installVacpDebugUi({ enabled: 'auto', globalKey: '__vacp' });

  const appId = 'vacp-examples';
  const viewId = 'vanilla/d3-lasso-scatter';
  const vizId = 'plot-0';
  const vizRef = makeRef([appId, viewId, vizId]);
  const pointsRef = makeRef([appId, viewId, vizId, 'mark', 'points']);
  const lassoRef = makeRef([appId, viewId, vizId, 'selection', 'lasso']);

  const width = 640;
  const height = 420;
  const margin = { top: 18, right: 18, bottom: 30, left: 36 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const data = makePoints();

  const x = d3.scaleLinear().domain([0, 100]).range([0, innerW]).nice();
  const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]).nice();

  let lassoPolygonDomain: DomainPoint[] | null = null;
  let selectedIds = new Set<string>();

  const svg = d3
    .select(plotRoot)
    .append('svg')
    .attr('class', 'plot')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', width)
    .attr('height', height)
    .attr('role', 'img');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x));
  g.append('g').attr('class', 'y-axis').call(d3.axisLeft(y));

  const pointsG = g.append('g').attr('class', 'points');

  const lassoLayer = g.append('g').attr('class', 'lasso-layer');
  const lassoPath = lassoLayer
    .append('path')
    .attr('fill', 'rgba(37,99,235,0.12)')
    .attr('stroke', '#2563eb')
    .attr('stroke-width', 1.5)
    .attr('display', 'none');

  // Transparent overlay to capture pointer events for lasso.
  const overlay = g
    .append('rect')
    .attr('class', 'overlay')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair');

  function polygonDomainToPath(poly: DomainPoint[]): string {
    const p = poly.map((d) => [x(d.x), y(d.y)] as [number, number]);
    const line = d3.line<[number, number]>();
    return `${line(p) ?? ''}Z`;
  }

  function recomputeSelection(): void {
    selectedIds = new Set<string>();
    if (!lassoPolygonDomain || lassoPolygonDomain.length < 3) return;
    const polyPx = lassoPolygonDomain.map((d) => [x(d.x), y(d.y)] as [number, number]);
    for (const pt of data) {
      const px: [number, number] = [x(pt.x), y(pt.y)];
      if (d3.polygonContains(polyPx, px)) selectedIds.add(pt.id);
    }
  }

  function render(): void {
    recomputeSelection();

    pointsG
      .selectAll<SVGCircleElement, Point>('circle')
      .data(data, (d) => d.id)
      .join('circle')
      .attr('cx', (d) => x(d.x))
      .attr('cy', (d) => y(d.y))
      .attr('r', 3)
      .attr('fill', (d) => (selectedIds.has(d.id) ? '#2563eb' : '#94a3b8'))
      .attr('opacity', (d) => (selectedIds.has(d.id) ? 0.95 : 0.35));

    if (lassoPolygonDomain && lassoPolygonDomain.length >= 3) {
      lassoPath.attr('display', null).attr('d', polygonDomainToPath(lassoPolygonDomain));
    } else {
      lassoPath.attr('display', 'none').attr('d', '');
    }
  }

  // ---- VACP wiring (no framework) -----------------------------------------
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
      { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: 'D3 lasso scatter', data: { width, height } },
      { ref: pointsRef, kind: 'Mark', layer: 'VisualizationLayer', title: 'points', description: 'scatter points' },
      { ref: lassoRef, kind: 'Selection', layer: 'InteractionFeedbackLayer', title: 'lasso', description: 'freeform polygon selection' },
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
    lassoPolygonDomain = poly.length >= 3 ? poly : null;
    render();
    return { ok: true, selectedCount: selectedIds.size };
  });
  registry.register(actions[1], async () => {
    lassoPolygonDomain = null;
    selectedIds = new Set<string>();
    render();
    return { ok: true };
  });

  // Standard debug action: allow applying a state JSON map to the live plot.
  // This is a "glue" action intended for a debug UI, not for production agents.
  const applyStateDesc = registerVacpDebugApplyStateAction(
    registry,
    async (state) => {
      const errors: Array<{ ref: string; message: string }> = [];
      const raw = state[lassoRef];
      if (raw === undefined) return { applied: 0, errors };
      const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const poly = rec.polygon;
      try {
        if (poly === null || poly === undefined) {
          lassoPolygonDomain = null;
          selectedIds = new Set<string>();
          render();
          return { applied: 1, errors };
        }
        if (!Array.isArray(poly)) throw new Error('Expected polygon to be an array of {x,y}');
        const pts = poly
          .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
          .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        lassoPolygonDomain = pts.length >= 3 ? pts : null;
        render();
        return { applied: 1, errors };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ ref: lassoRef, message });
        return { applied: 0, errors };
      }
    },
    { targetRef: lassoRef, description: 'Debug: apply lasso selection state (polygon) to the live D3 plot.' },
  );
  actions.push(applyStateDesc);

  applyVacpAttributes(svg.node()!, { ref: vizRef, layer: 'VisualizationLayer', kind: 'Visualization', title: 'D3 lasso scatter' });
  applyVacpInteractionAttributes(svg.node()!, {
    targetRef: vizRef,
    layer: 'VisualizationLayer',
    description: 'Programmatic interactions for this D3 visualization.',
    actions,
  });
  embedVacpGraphInSvg(svg.node()!, graph);

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({ version: VACP_SCHEMA_VERSION, createdAt: nowIso(), graph }),
    getState: async (): Promise<VacpStateSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      state: {
        [lassoRef]: {
          kind: 'Selection',
          polygon: lassoPolygonDomain ?? null,
          selectedCount: selectedIds.size,
        },
      },
    }),
  };

  const bridge = installVacpRuntimeBridge({ snapshots, actions: registry, globalKey: '__vacp' });

  async function refreshDebug(): Promise<void> {
    const [cap, st] = await Promise.all([bridge.getCapabilities(), bridge.getState()]);
    statePre.textContent = safeJson(st);
    const diagram = renderVacpDiagramMermaid({
      capabilities: cap,
      state: st,
      options: { direction: 'LR', includeActions: true, includeStatePreview: true },
    });
    diagramPre.textContent = `\`\`\`mermaid\n${diagram}\n\`\`\``;

    const svgEl = svg.node()!;
    const hasMeta = !!svgEl.querySelector('metadata[type="application/vacp+json"]');
    const checks = [
      `Bridge: ok (actions=${cap.graph.actions.length}, nodes=${cap.graph.nodes.length})`,
      `SVG data-vacp-ref: ${svgEl.getAttribute('data-vacp-ref') ? 'ok' : 'missing'}`,
      `SVG data-interaction-vacp-actions: ${svgEl.getAttribute('data-interaction-vacp-actions') ? 'ok' : 'missing'}`,
      `SVG metadata graph: ${hasMeta ? 'ok' : 'missing'}`,
      `Selected: ${selectedIds.size}`,
    ];
    checksDiv.textContent = checks.join(' • ');
  }

  void refreshDebug();

  refreshBtn.addEventListener('click', () => void refreshDebug());
  demoSetBtn.addEventListener('click', async () => {
    const poly: DomainPoint[] = [
      { x: 25, y: 25 },
      { x: 75, y: 25 },
      { x: 75, y: 75 },
      { x: 25, y: 75 },
    ];
    await bridge.execute({ callId: crypto.randomUUID(), name: 'vanilla.set_lasso_polygon', params: { points: poly } });
    await refreshDebug();
  });
  demoClearBtn.addEventListener('click', async () => {
    await bridge.execute({ callId: crypto.randomUUID(), name: 'vanilla.clear_lasso' });
    await refreshDebug();
  });

  // ---- Human lasso interaction ---------------------------------------------
  let drawing = false;
  let polyPx: Array<[number, number]> = [];

  const toDomain = (px: [number, number]): DomainPoint => ({ x: x.invert(px[0]), y: y.invert(px[1]) });

  overlay
    .on('pointerdown', (event: PointerEvent) => {
      drawing = true;
      polyPx = [];
      const [px, py] = d3.pointer(event, overlay.node()!);
      polyPx.push([px, py]);
      lassoPath.attr('display', null).attr('d', `${d3.line()(polyPx) ?? ''}`);
      overlay.node()!.setPointerCapture(event.pointerId);
    })
    .on('pointermove', (event: PointerEvent) => {
      if (!drawing) return;
      const [px, py] = d3.pointer(event, overlay.node()!);
      polyPx.push([px, py]);
      lassoPath.attr('d', `${d3.line()(polyPx) ?? ''}`);
    })
    .on('pointerup', async (event: PointerEvent) => {
      if (!drawing) return;
      drawing = false;
      overlay.node()!.releasePointerCapture(event.pointerId);
      if (polyPx.length >= 3) {
        lassoPolygonDomain = polyPx.map(toDomain);
      } else {
        lassoPolygonDomain = null;
      }
      render();
      await bridge.refresh?.({ source: 'human', message: 'lasso' });
      await refreshDebug();
    });

  render();
}

main();
