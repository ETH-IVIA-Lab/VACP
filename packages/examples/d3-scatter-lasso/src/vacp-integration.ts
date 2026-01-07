import type { VacpActionDescriptor, VacpDemo } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';
import { createDuckDbDataSqlHandler, createDuckDbWasmClient } from '@vacp/duckdb';
import type { VacpGraphBase } from '@vacp/kit';
import { createVacpRefBuilder, installVacpDom, installVacpProvider } from '@vacp/kit';
import { registerVacpApplyStateAction, registerVacpDataSqlAction, VacpActionRegistry } from '@vacp/gateway';

export type DomainPoint = { x: number; y: number };
export type DataPoint = { id: string; x: number; y: number };

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function installVacpForD3ScatterLasso(args: {
  root: Element;
  svg: SVGSVGElement;
  appId: string;
  viewId: string;
  vizId: string;
  width: number;
  height: number;
  title: string;
  globalKey: string;
  demos: VacpDemo[];
  data: DataPoint[];
  getLassoPolygon: () => DomainPoint[] | null;
  setLassoPolygon: (poly: DomainPoint[] | null) => void;
  getSelectedIds: () => string[];
  getSelectedCount: () => number;
  clearSelection: () => void;
}) {
  const viewRefs = createVacpRefBuilder({ appId: args.appId, viewId: args.viewId });
  const vizRefs = createVacpRefBuilder({ appId: args.appId, viewId: args.viewId, vizId: args.vizId });

  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;
  const pointsRef = vizRefs.ref('/mark/points');
  const lassoRef = vizRefs.ref('/selection/lasso');
  const handleRef = vizRefs.ref('/data/points');

  const registry = new VacpActionRegistry();

  const duckdbPromise = createDuckDbWasmClient({ log: false });
  const pointsTable = 'vacp_d3_points';

  const ensureDuckDbLoaded = async (): Promise<void> => {
    const db = await duckdbPromise;
    await db.exec(`CREATE TABLE IF NOT EXISTS ${pointsTable} (id VARCHAR, x DOUBLE, y DOUBLE)`);
    const existing = await db.queryJson(`SELECT COUNT(*)::INTEGER AS n FROM ${pointsTable}`);
    if ((existing.rows[0]?.n as number | undefined) === args.data.length) return;
    await db.exec(`DELETE FROM ${pointsTable}`);
    await db.loadObjectsAsTable(pointsTable, args.data, { create: false });
  };

  const syncSelectedIds = async (): Promise<void> => {
    const db = await duckdbPromise;
    await ensureDuckDbLoaded();
    await db.exec('CREATE TEMP TABLE IF NOT EXISTS vacp_d3_selected_ids(id VARCHAR)');
    await db.exec('DELETE FROM vacp_d3_selected_ids');
    const ids = args.getSelectedIds();
    if (ids.length) {
      const values = ids.map((id) => `(${sqlStringLiteral(id)})`).join(',');
      await db.exec(`INSERT INTO vacp_d3_selected_ids VALUES ${values}`);
    }
  };

  const graph: VacpGraphBase = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      {
        ref: viewRef,
        kind: 'View',
        layer: 'ViewLayer',
        title: 'D3 scatter + lasso',
        description: 'A frameworkless D3 chart with lasso selection + DuckDB DataHandle.',
      },
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
      {
        ref: handleRef,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: 'points (DuckDB handle)',
        description:
          'A DuckDB-backed handle for the scatter dataset. `vacp_handle` is the lasso-selected subset (or all rows if empty).',
        data: { primaryKey: 'id', allTable: pointsTable },
      },
    ],
    edges: [
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: pointsRef, kind: 'contains' },
      { from: vizRef, to: lassoRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
    ],
  };

  const setLassoAction: VacpActionDescriptor = {
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
  };

  const clearLassoAction: VacpActionDescriptor = {
    name: 'vanilla.clear_lasso',
    description: 'Clear the current lasso selection.',
    targetRef: lassoRef,
    parameters: { type: 'object', properties: {} },
  };

  registry.register(setLassoAction, async (params) => {
    const p = (params ?? {}) as { points?: Array<{ x: unknown; y: unknown }> };
    const pts = Array.isArray(p.points) ? p.points : [];
    const poly: DomainPoint[] = pts
      .map((d) => ({ x: Number(d.x), y: Number(d.y) }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    args.setLassoPolygon(poly.length >= 3 ? poly : null);
    return { ok: true, selectedCount: args.getSelectedCount() };
  });

  registry.register(clearLassoAction, async () => {
    args.clearSelection();
    return { ok: true };
  });

  registerVacpDataSqlAction(
    registry,
    createDuckDbDataSqlHandler({
      duckdb: {
        getConnection: () => duckdbPromise.then((d) => d.getConnection()),
        exec: (sql) => duckdbPromise.then((d) => d.exec(sql)),
        queryJson: (sql) => duckdbPromise.then((d) => d.queryJson(sql)),
        queryArrowIpcBase64: (sql) => duckdbPromise.then((d) => d.queryArrowIpcBase64(sql)),
        loadObjectsAsTable: (tableName, rows, options) =>
          duckdbPromise.then((d) => d.loadObjectsAsTable(tableName, rows, options)),
      },
      resolveHandle: async (ref) => {
        if (ref !== handleRef) return null;
        await syncSelectedIds();
        const selectedCount = args.getSelectedCount();
        const allSql = `SELECT * FROM ${pointsTable}`;
        const selectedSql =
          selectedCount > 0
            ? `SELECT p.* FROM ${pointsTable} p JOIN vacp_d3_selected_ids s USING(id)`
            : `SELECT * FROM ${pointsTable}`;
        return { allSql, selectedSql };
      },
    }),
    { targetRef: handleRef, description: 'Query the currently selected points using DuckDB SQL.' },
  );

  registerVacpApplyStateAction(
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

  const { bridge, snapshots } = installVacpProvider({
    graph,
    actions: registry,
    demos: args.demos,
    globalKey: args.globalKey,
    getState: () => ({
      [lassoRef]: {
        kind: 'Selection',
        polygon: args.getLassoPolygon() ?? null,
        selectedCount: args.getSelectedCount(),
      },
      [handleRef]: {
        kind: 'DataHandle',
        allCount: args.data.length,
        selectedCount: args.getSelectedCount(),
        selectedMeaning: 'lasso-selected rows; falls back to all rows if empty',
      },
    }),
  });

  const getGraph = () => snapshots.getGraph();
  const annotate = () => {
    installVacpDom({ root: args.root, rootAnnotation: { ref: viewRef, kind: 'View', layer: 'ViewLayer' }, getGraph });
    installVacpDom({
      root: args.svg,
      svg: args.svg,
      rootAnnotation: { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: args.title },
      interactions: {
        targetRef: vizRef,
        layer: 'VisualizationLayer',
        description: 'Semantic actions for lasso selection and DuckDB queries.',
        actions: () => registry.list(),
      },
      getGraph,
    });
  };

  annotate();

  return { bridge, vizRef, pointsRef, lassoRef, handleRef };
}
