import type { VacpActionDescriptor } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';
import type { VacpGraphBase } from '@vacp/kit';
import { createVacpRefBuilder, installVacpDom, installVacpProvider } from '@vacp/kit';
import { createDuckDbDataSqlHandler, createDuckDbWasmClient } from '@vacp/duckdb';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { registerVacpApplyStateAction, registerVacpDataSqlAction, VacpActionRegistry } from '@vacp/gateway';

type Datum = { id: number; x: number; y: number; group: 'A' | 'B' | 'C' };

function randomData(n = 80): Datum[] {
  const out: Datum[] = [];
  for (let i = 0; i < n; i++) {
    const group = i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C';
    out.push({ id: i + 1, x: Math.random() * 100, y: Math.random() * 100, group });
  }
  return out;
}

function renderScatter(args: {
  root: HTMLElement;
  data: Datum[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
}): SVGSVGElement {
  const { root, data, selectedIds, onToggle } = args;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 800 480');

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '800');
  bg.setAttribute('height', '480');
  bg.setAttribute('fill', '#ffffff');
  bg.setAttribute('rx', '10');
  svg.append(bg);

  const pad = 42;
  const xScale = (x: number) => pad + (x / 100) * (800 - pad * 2);
  const yScale = (y: number) => 480 - pad - (y / 100) * (480 - pad * 2);

  const axes = document.createElementNS(svgNS, 'g');
  axes.setAttribute('stroke', '#94a3b8');
  axes.setAttribute('stroke-width', '1');
  const xAxis = document.createElementNS(svgNS, 'line');
  xAxis.setAttribute('x1', String(pad));
  xAxis.setAttribute('y1', String(480 - pad));
  xAxis.setAttribute('x2', String(800 - pad));
  xAxis.setAttribute('y2', String(480 - pad));
  const yAxis = document.createElementNS(svgNS, 'line');
  yAxis.setAttribute('x1', String(pad));
  yAxis.setAttribute('y1', String(pad));
  yAxis.setAttribute('x2', String(pad));
  yAxis.setAttribute('y2', String(480 - pad));
  axes.append(xAxis, yAxis);
  svg.append(axes);

  const dots = document.createElementNS(svgNS, 'g');
  dots.setAttribute('fill', '#2563eb');
  dots.setAttribute('stroke', 'rgba(15,23,42,0.25)');
  dots.setAttribute('stroke-width', '1');

  data.forEach((d) => {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', String(xScale(d.x)));
    c.setAttribute('cy', String(yScale(d.y)));
    c.setAttribute('r', selectedIds.has(d.id) ? '6.5' : '5');
    c.setAttribute('fill', d.group === 'A' ? '#2563eb' : d.group === 'B' ? '#16a34a' : '#f97316');
    c.setAttribute('opacity', selectedIds.size && !selectedIds.has(d.id) ? '0.25' : '0.92');
    c.style.cursor = 'pointer';
    c.addEventListener('click', () => onToggle(d.id));
    dots.append(c);
  });
  svg.append(dots);

  root.replaceChildren(svg);
  return svg;
}

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const clearBtn = document.querySelector<HTMLButtonElement>('#clear');
  if (!app || !clearBtn) throw new Error('Missing root elements');

  const globalKey = '__vacp';
  installVacpDebugUi({ enabled: 'auto', globalKey });

  const appId = 'vacp-examples';
  const viewId = 'vanilla/minimal';
  const vizId = 'scatter';

  const viewRefs = createVacpRefBuilder({ appId, viewId });
  const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });
  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;
  const selectionRef = vizRefs.ref('/selection/points');
  const handleRef = vizRefs.ref('/data/points');

  const data = randomData();
  const selectedIds = new Set<number>();

  const duckdb = await createDuckDbWasmClient({ log: false });
  const tableName = `vacp_vanilla_points_${crypto.randomUUID().slice(0, 8)}`;
  await duckdb.loadObjectsAsTable(
    tableName,
    data.map((d) => ({ id: d.id, x: d.x, y: d.y, group: d.group })),
    { create: true },
  );

  const actionRegistry = new VacpActionRegistry();
  let rerender: (source: 'human' | 'agent' | 'system') => void = () => {};

  const selectAction: VacpActionDescriptor = {
    name: 'vanilla.toggle_point',
    description: 'Toggle a point id in the current selection.',
    targetRef: selectionRef,
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  };
  actionRegistry.register(selectAction, async (params) => {
    const id = (params as any)?.id;
    if (typeof id !== 'number' || !Number.isFinite(id)) throw new Error('Expected integer params.id');
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    rerender('agent');
    return { selectedIds: Array.from(selectedIds) };
  });

  const clearAction: VacpActionDescriptor = {
    name: 'vanilla.clear_selection',
    description: 'Clear the current selection.',
    targetRef: selectionRef,
    parameters: { type: 'object', properties: {} },
  };
  actionRegistry.register(clearAction, async () => {
    selectedIds.clear();
    rerender('agent');
    return { selectedIds: [] };
  });

  registerVacpApplyStateAction(
    actionRegistry,
    async (state) => {
      const rec = state[selectionRef];
      const v = rec && typeof rec === 'object' ? ((rec as any).value ?? rec) : rec;
      const ids = Array.isArray(v) ? v : [];
      selectedIds.clear();
      ids.forEach((x) => {
        if (typeof x === 'number' && Number.isFinite(x)) selectedIds.add(x);
      });
      rerender('agent');
      return { selectedIds: Array.from(selectedIds) };
    },
    { targetRef: selectionRef, description: 'Apply selection state (selected ids).' },
  );

  registerVacpDataSqlAction(
    actionRegistry,
    createDuckDbDataSqlHandler({
      duckdb,
      resolveHandle: async (ref) => {
        if (ref !== handleRef) return null;
        const allSql = `SELECT * FROM ${tableName}`;
        const selected = selectedIds.size
          ? `SELECT * FROM ${tableName} WHERE id IN (${Array.from(selectedIds).join(',')})`
          : allSql;
        return { allSql, selectedSql: selected };
      },
    }),
    { targetRef: handleRef, description: 'Query the selected points via DuckDB SQL.' },
  );

  const graph: VacpGraphBase = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      {
        ref: viewRef,
        kind: 'View',
        layer: 'ViewLayer',
        title: 'Vanilla minimal',
        description: 'A minimal VACP provider: SVG + click selection + DuckDB DataHandle.',
      },
      { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Scatterplot (SVG)' },
      {
        ref: selectionRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'Selected points',
        description: 'Selected point ids. Used to compute the DataHandle selection relation.',
        data: { type: 'set', item: 'point id' },
      },
      {
        ref: handleRef,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: 'points (DuckDB handle)',
        description: 'Query `vacp_all` and `vacp_handle` via `vacp.data_sql`.',
        data: { tableName },
      },
    ],
    edges: [
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: selectionRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
      { from: selectionRef, to: handleRef, kind: 'controls' },
    ],
  };

  const { bridge, snapshots } = installVacpProvider({
    graph,
    actions: actionRegistry,
    globalKey,
    getState: () => ({
      [selectionRef]: { kind: 'Selection', value: Array.from(selectedIds) },
      [handleRef]: {
        kind: 'DataHandle',
        tableName,
        selectedCount: selectedIds.size,
        selectedMeaning: selectedIds.size ? 'rows whose id is selected' : 'all rows (empty selection)',
      },
    }),
  });

  rerender = (source: 'human' | 'agent' | 'system') => {
    const svg = renderScatter({
      root: app,
      data,
      selectedIds,
      onToggle: (id) => {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        rerender('human');
      },
    });
    const getGraph = () => snapshots.getGraph();
    installVacpDom({
      root: app,
      rootAnnotation: { ref: viewRef, kind: 'View', layer: 'ViewLayer', title: 'Vanilla minimal' },
      getGraph,
    });
    installVacpDom({
      root: svg,
      svg,
      rootAnnotation: {
        ref: vizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'Scatterplot (SVG)',
      },
      interactions: {
        targetRef: vizRef,
        layer: 'VisualizationLayer',
        description: 'Semantic actions for selection and DuckDB queries.',
        actions: () => actionRegistry.list(),
      },
      getGraph,
    });
    void bridge.refresh?.({ source, message: 'selection changed' }).catch(() => {});
  };

  clearBtn.addEventListener('click', () => {
    selectedIds.clear();
    rerender('human');
  });

  rerender('system');
}
