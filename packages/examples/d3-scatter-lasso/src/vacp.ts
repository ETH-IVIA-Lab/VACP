/**
 * VACP integration layer for the D3 lasso scatterplot.
 *
 * The goal is to keep VACP as a composable adapter:
 * - the chart stays a normal D3 chart (`chart.ts`)
 * - this layer adds a graph + semantic actions + DuckDB data access
 */

import type { VacpGraphBase } from '@vacp/kit';
import {
  createDuckDbSqlRouter,
  createVacpActions,
  createVacpLayer,
  createVacpRefBuilder,
  makeVacpDuckDbTableName,
} from '@vacp/kit';
import { createDuckDbWasmClient, getDuckDbTableMetadata, type VacpDuckDbTableMetadata } from '@vacp/duckdb';
import { VACP_SCHEMA_VERSION } from '@vacp/core';
import { buildD3ScatterLassoPlaybooks } from './playbooks';

import type { DomainPoint, Point } from './chart';

export function installVacpForD3ScatterLasso(args: {
  root: HTMLElement;
  svg: SVGSVGElement;
  globalKey: string;
  title: string;
  data: Point[];
  getLassoPolygon: () => DomainPoint[] | null;
  setLassoPolygon: (poly: DomainPoint[] | null) => void;
  clearSelection: () => void;
  getSelectedIds: () => string[];
  getSelectedCount: () => number;
}) {
  const appId = 'vacp-examples';
  const viewId = 'vanilla/d3-scatter-lasso';
  const vizId = 'plot-0';

  const viewRefs = createVacpRefBuilder({ appId, viewId });
  const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });

  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;
  const pointsRef = vizRefs.ref('/mark/points');
  const lassoRef = vizRefs.ref('/selection/lasso');
  const handleRef = vizRefs.ref('/data/points');

  const actions = createVacpActions();

  actions
    .action('vanilla.set_lasso_polygon', 'Set the lasso selection polygon in data (domain) coordinates.')
    .target(lassoRef)
    .params({
      type: 'object',
      properties: {
        points: {
          type: 'array',
          items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        },
      },
      required: ['points'],
    })
    .handle((params) => {
      const p = (params ?? {}) as { points?: Array<{ x: unknown; y: unknown }> };
      const pts = Array.isArray(p.points) ? p.points : [];
      const poly: DomainPoint[] = pts
        .map((d) => ({ x: Number(d.x), y: Number(d.y) }))
        .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
      args.setLassoPolygon(poly.length >= 3 ? poly : null);
      return { selectedCount: args.getSelectedCount() };
    });

  actions
    .action('vanilla.clear_lasso', 'Clear the current lasso selection.')
    .target(lassoRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.clearSelection();
      return { ok: true };
    });

  actions.standard.applyState(
    (state) => {
      const raw = state[lassoRef as unknown as string];
      const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const poly = rec.polygon;
      if (poly === null || poly === undefined) {
        args.clearSelection();
        return { applied: 1 };
      }
      if (!Array.isArray(poly)) throw new Error('Expected polygon to be an array of {x,y}');
      const pts = poly
        .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
        .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      args.setLassoPolygon(pts.length >= 3 ? pts : null);
      return { applied: 1 };
    },
    { targetRef: lassoRef, description: 'Apply lasso selection state (polygon) to the live D3 plot.' },
  );

  // DuckDB: one table for all points + a temp table for selected ids.
  const duckdb = createDuckDbWasmClient({ log: false });
  const pointsTable = makeVacpDuckDbTableName({ prefix: 'vacp_d3_points' });
  let pointsTableMeta: VacpDuckDbTableMetadata | null = null;
  let loaded = false;

  const ensureDuckDbLoaded = async (): Promise<void> => {
    const db = await duckdb;
    if (loaded) return;
    // Use DuckDB inference from the JSON rows (no manual schema).
    await db.exec(`DROP TABLE IF EXISTS ${pointsTable}`);
    await db.loadObjectsAsTable(pointsTable, args.data, { create: true });
    pointsTableMeta = await getDuckDbTableMetadata({ duckdb: db, table: pointsTable });
    loaded = true;
  };

  const sqlStringLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const syncSelectedIds = async (): Promise<void> => {
    const db = await duckdb;
    await ensureDuckDbLoaded();
    await db.exec('CREATE TEMP TABLE IF NOT EXISTS vacp_d3_selected_ids(id VARCHAR)');
    await db.exec('DELETE FROM vacp_d3_selected_ids');
    const ids = args.getSelectedIds();
    if (ids.length) {
      const values = ids.map((id) => `(${sqlStringLiteral(id)})`).join(',');
      await db.exec(`INSERT INTO vacp_d3_selected_ids VALUES ${values}`);
    }
  };

  const sql = createDuckDbSqlRouter({ duckdb });
  sql.addHandle({
    handleRef,
    getAllSql: async () => {
      await ensureDuckDbLoaded();
      return `SELECT * FROM ${pointsTable}`;
    },
    getSelectedSql: async () => {
      await syncSelectedIds();
      return args.getSelectedCount() > 0
        ? `SELECT p.* FROM ${pointsTable} p JOIN vacp_d3_selected_ids s USING(id)`
        : `SELECT * FROM ${pointsTable}`;
    },
  });
  actions.standard.dataSql(sql.handler, {
    targetRef: handleRef,
    description: 'Query the current selection via DuckDB SQL.',
  });

  const graph: VacpGraphBase = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      { ref: viewRef, kind: 'View', layer: 'ViewLayer', title: args.title },
      { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: args.title },
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
        description: 'A DuckDB-backed handle; `vacp_handle` is the lasso-selected subset (or all rows if empty).',
        data: { primaryKey: 'id', tableName: pointsTable, duckdb: pointsTableMeta },
      },
    ],
    edges: [
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: pointsRef, kind: 'contains' },
      { from: vizRef, to: lassoRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
    ],
  };

  const playbooks = buildD3ScatterLassoPlaybooks();

  const vacp = createVacpLayer({
    globalKey: args.globalKey,
    graph,
    actions: actions.registry,
    playbooks,
    getState: () => ({
      [lassoRef]: {
        kind: 'Selection',
        polygon: args.getLassoPolygon() ?? null,
        selectedCount: args.getSelectedCount(),
      },
      [handleRef]: {
        kind: 'DataHandle',
        tableName: pointsTable,
        allCount: args.data.length,
        selectedCount: args.getSelectedCount(),
        selectedMeaning: 'lasso-selected rows; falls back to all rows if empty',
        duckdb: pointsTableMeta,
      },
    }),
    dom: {
      view: { root: args.root, annotation: { ref: viewRef, kind: 'View', layer: 'ViewLayer', title: args.title } },
      viz: {
        svg: args.svg,
        annotation: { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: args.title },
        interactions: {
          targetRef: vizRef,
          layer: 'VisualizationLayer',
          description: 'Semantic lasso actions + DuckDB queries.',
        },
      },
    },
  });

  vacp.annotate();

  return { ...vacp, refs: { viewRef, vizRef, lassoRef, handleRef } };
}
