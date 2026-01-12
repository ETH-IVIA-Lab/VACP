/**
 * VACP integration layer.
 *
 * This module adds an agent-facing contract on top of the React dashboard:
 * - capabilities/state snapshots (`window.__vacp`)
 * - semantic actions (dataset/encoding/selection/brush)
 * - DuckDB access via the standard `vacp.data_sql` action
 *
 * The dashboard implementation (React + zustand) stays VACP-agnostic; the VACP
 * layer receives a small model adapter (getters/setters) similar to the other
 * “bring-your-own-provider” examples.
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
import { VACP_SCHEMA_VERSION, type VacpRef } from '@vacp/core';

import type { Dataset, DatasetId, Encoding } from '@/datasets/registry';
import { isDatasetId } from '@/datasets/registry';
import { applyBrush, intersectIds, pointInPolygon, sortRowsByNumericKey, toFiniteNumber } from '@/lib/dashboard';
import type { BrushRange, LassoPolygon } from '@/state/dashboard-store';

export type ReactDashboardModel = {
  ensureDataset: () => Promise<void>;
  getDatasetId: () => DatasetId;
  getDataset: () => Dataset | null;
  setDatasetId: (id: DatasetId) => Promise<void>;
  getEncoding: () => Encoding;
  setEncoding: (patch: Partial<Encoding>) => void;
  getSelectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;
  applyLassoSelection: (polygon: LassoPolygon, ids: string[]) => void;
  getLassoPolygon: () => LassoPolygon | null;
  toggleSelectedId: (id: string) => void;
  clearSelection: () => void;
  getBrush: () => BrushRange;
  setBrush: (range: BrushRange) => void;
  clearBrush: () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getPropString(obj: Record<string, unknown> | null, key: string): string | null {
  const v = obj ? obj[key] : undefined;
  return typeof v === 'string' ? v : null;
}

function getPropNumber(obj: Record<string, unknown> | null, key: string): number | null {
  const v = obj ? obj[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function getPropArray(obj: Record<string, unknown> | null, key: string): unknown[] | null {
  const v = obj ? obj[key] : undefined;
  return Array.isArray(v) ? v : null;
}

function unwrapVacpValue(rec: unknown): unknown {
  const obj = asRecord(rec);
  if (!obj) return rec;
  return obj.value !== undefined ? obj.value : rec;
}

function getEffectiveSelectedIds(model: ReactDashboardModel): { ids: string[]; meaning: string } {
  const dataset = model.getDataset();
  if (!dataset) return { ids: [], meaning: 'no dataset loaded' };

  const encoding = model.getEncoding();
  const selectedIds = model.getSelectedIds();
  const brush = model.getBrush();

  const sorted = sortRowsByNumericKey(dataset.rows, encoding.x);
  const brushed = applyBrush(sorted, brush);
  const brushedIds = brushed.map((r) => r.id);

  if (selectedIds.length) {
    if (!brush) return { ids: selectedIds, meaning: 'explicit selection ids' };
    const ids = intersectIds(selectedIds, brushedIds);
    return { ids, meaning: 'intersection(selection, brush)' };
  }

  if (brush) return { ids: brushedIds, meaning: 'brush subset (no explicit selection)' };
  return { ids: [], meaning: 'no selection (fallback: all rows)' };
}

export function installVacpForReactDashboard(args: { globalKey: string; title?: string; model: ReactDashboardModel }) {
  const appId = 'vacp-examples';
  const viewId = 'react/dashboard';
  const vizId = 'recharts';

  const title = args.title ?? 'React dashboard';

  const viewRefs = createVacpRefBuilder({ appId, viewId });
  const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });
  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;

  const scatterVizRef = vizRefs.ref('/viz/scatter');
  const brushVizRef = vizRefs.ref('/viz/brush');

  const scatterRef = vizRefs.ref('/viz/scatter/mark/scatter');
  const rankPlotRef = vizRefs.ref('/viz/brush/mark/rank_plot');

  const selectionRef = vizRefs.ref('/viz/scatter/selection/points');
  const lassoRef = vizRefs.ref('/viz/scatter/selection/lasso');
  const brushRef = vizRefs.ref('/viz/brush/selection/brush');
  const handleRef = vizRefs.ref('/data/rows');

  const actions = createVacpActions();

  actions
    .action('dashboard.set_dataset', 'Set the active dataset (loads JSON rows and rebuilds the DuckDB table).')
    .target(handleRef)
    .params({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] })
    .handle(async (params) => {
      const id = getPropString(asRecord(params), 'id') ?? '';
      if (!isDatasetId(id)) throw new Error(`Unknown dataset id: ${id}`);
      await args.model.setDatasetId(id);
      return { datasetId: id };
    });

  actions
    .action('dashboard.set_encoding', 'Set x/y/color encodings for the scatterplot.')
    .target(scatterRef)
    .params({
      type: 'object',
      properties: {
        x: { type: 'string' },
        y: { type: 'string' },
        color: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['x', 'y'],
    })
    .handle((params) => {
      const p = asRecord(params) ?? {};
      const x = typeof p.x === 'string' ? p.x : '';
      const y = typeof p.y === 'string' ? p.y : '';
      const color = p.color === null || typeof p.color === 'string' ? (p.color as string | null) : null;
      if (!x || !y) throw new Error('Expected params.x and params.y');
      args.model.setEncoding({ x, y, color });
      return { ok: true };
    });

  actions
    .action('dashboard.set_selected_ids', 'Set the selected row ids (replaces current selection).')
    .target(selectionRef)
    .params({ type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] })
    .handle((params) => {
      const ids = getPropArray(asRecord(params), 'ids') ?? [];
      args.model.setSelectedIds(ids.map(String));
      return { selectedCount: args.model.getSelectedIds().length };
    });

  actions
    .action(
      'dashboard.set_lasso',
      'Set a lasso polygon in data space (x/y) and replace the selection with matching ids.',
    )
    .target(lassoRef)
    .params({
      type: 'object',
      properties: {
        polygon: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
        },
      },
      required: ['polygon'],
    })
    .handle(async (params) => {
      const poly = getPropArray(asRecord(params), 'polygon') ?? [];
      const polygon: LassoPolygon = poly.flatMap((p): LassoPolygon => {
        const pt = asRecord(p);
        const x = getPropNumber(pt, 'x');
        const y = getPropNumber(pt, 'y');
        if (x === null || y === null) return [];
        return [{ x, y }];
      });
      if (polygon.length < 3) throw new Error('Expected polygon with >= 3 (x,y) points');

      await args.model.ensureDataset();
      const dataset = args.model.getDataset();
      if (!dataset) throw new Error('No dataset loaded');
      const encoding = args.model.getEncoding();
      const brush = args.model.getBrush();

      const sorted = sortRowsByNumericKey(dataset.rows, encoding.x);
      const brushed = applyBrush(sorted, brush);
      const ids = brushed
        .map((row) => {
          const x = toFiniteNumber(row[encoding.x]);
          const y = toFiniteNumber(row[encoding.y]);
          if (x === null || y === null) return null;
          return pointInPolygon({ x, y }, polygon) ? row.id : null;
        })
        .filter((x): x is string => typeof x === 'string');

      args.model.applyLassoSelection(polygon, ids);
      return { selectedCount: ids.length };
    });

  actions
    .action('dashboard.clear_lasso', 'Clear the lasso polygon and clear the selection.')
    .target(lassoRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.model.clearSelection();
      return { ok: true };
    });

  actions
    .action('dashboard.toggle_selected_id', 'Toggle one row id in the selection.')
    .target(selectionRef)
    .params({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] })
    .handle((params) => {
      const id = getPropString(asRecord(params), 'id') ?? '';
      if (!id) throw new Error('Expected params.id');
      args.model.toggleSelectedId(id);
      return { selectedCount: args.model.getSelectedIds().length };
    });

  actions
    .action('dashboard.clear_selection', 'Clear the explicit point selection.')
    .target(selectionRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.model.clearSelection();
      return { ok: true };
    });

  actions
    .action('dashboard.set_brush', 'Set the x brush by start/end indices over rows sorted by the x encoding.')
    .target(brushRef)
    .params({
      type: 'object',
      properties: { startIndex: { type: 'integer' }, endIndex: { type: 'integer' } },
      required: ['startIndex', 'endIndex'],
    })
    .handle((params) => {
      const p = asRecord(params);
      const startIndex = Number(p?.startIndex);
      const endIndex = Number(p?.endIndex);
      if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex))
        throw new Error('Expected integer startIndex/endIndex');
      args.model.setBrush({ startIndex, endIndex });
      return { brush: args.model.getBrush() };
    });

  actions
    .action('dashboard.clear_brush', 'Clear the current brush filter.')
    .target(brushRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.model.clearBrush();
      return { ok: true };
    });

  actions.standard.applyState(
    async (state) => {
      let applied = 0;

      // Scatter encodings (+ optional dataset switch).
      {
        const rec = state[scatterRef as unknown as string];
        const obj = rec && typeof rec === 'object' ? (rec as Record<string, unknown>) : null;
        if (obj) {
          const datasetId = typeof obj.datasetId === 'string' ? obj.datasetId : null;
          if (datasetId && isDatasetId(datasetId)) {
            await args.model.setDatasetId(datasetId);
            applied += 1;
          }

          const patch: Partial<Encoding> = {};
          if (typeof obj.x === 'string') patch.x = obj.x;
          if (typeof obj.y === 'string') patch.y = obj.y;
          if (obj.color === null || typeof obj.color === 'string') patch.color = obj.color as string | null;
          if (Object.keys(patch).length) {
            args.model.setEncoding(patch);
            applied += 1;
          }
        }
      }

      // Selection ids.
      {
        const rec = state[selectionRef as unknown as string];
        if (rec !== undefined) {
          const v = unwrapVacpValue(rec);
          if (Array.isArray(v)) {
            args.model.setSelectedIds(v.map(String));
            applied += 1;
          } else if (v === null) {
            args.model.clearSelection();
            applied += 1;
          }
        }
      }

      // Lasso polygon.
      {
        const rec = state[lassoRef as unknown as string];
        if (rec !== undefined) {
          const v = unwrapVacpValue(rec);
          if (v === null) {
            args.model.clearSelection();
            applied += 1;
          } else if (Array.isArray(v)) {
            const polygon: LassoPolygon = v.flatMap((p): LassoPolygon => {
              const pt = asRecord(p);
              const x = getPropNumber(pt, 'x');
              const y = getPropNumber(pt, 'y');
              if (x === null || y === null) return [];
              return [{ x, y }];
            });
            if (polygon.length >= 3) {
              await args.model.ensureDataset();
              const dataset = args.model.getDataset();
              if (!dataset) return { applied };
              const encoding = args.model.getEncoding();
              const brush = args.model.getBrush();
              const sorted = sortRowsByNumericKey(dataset.rows, encoding.x);
              const brushed = applyBrush(sorted, brush);
              const ids = brushed
                .map((row) => {
                  const x = toFiniteNumber(row[encoding.x]);
                  const y = toFiniteNumber(row[encoding.y]);
                  if (x === null || y === null) return null;
                  return pointInPolygon({ x, y }, polygon) ? row.id : null;
                })
                .filter((x): x is string => typeof x === 'string');
              args.model.applyLassoSelection(polygon, ids);
              applied += 1;
            }
          }
        }
      }

      // Brush range.
      {
        const rec = state[brushRef as unknown as string];
        if (rec !== undefined) {
          const raw = rec && typeof rec === 'object' ? (rec as Record<string, unknown>) : null;
          const obj =
            raw && raw.value && typeof raw.value === 'object' && !Array.isArray(raw.value)
              ? (raw.value as Record<string, unknown>)
              : raw;
          const startRaw = obj ? obj.startIndex : undefined;
          const endRaw = obj ? obj.endIndex : undefined;

          if (startRaw === null || startRaw === undefined || endRaw === null || endRaw === undefined) {
            args.model.clearBrush();
            applied += 1;
          } else {
            const startIndex = Number(startRaw);
            const endIndex = Number(endRaw);
            if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) {
              args.model.clearBrush();
              applied += 1;
            } else {
              args.model.setBrush({ startIndex, endIndex });
              applied += 1;
            }
          }
        }
      }

      return { applied };
    },
    { targetRef: vizRef, description: 'Apply dashboard state (dataset/encoding/selection/brush).' },
  );

  // DuckDB: one table for the active dataset + a temp table for effective ids.
  const duckdb = createDuckDbWasmClient({ log: false });
  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_react_dashboard_rows' });
  let tableMeta: VacpDuckDbTableMetadata | null = null;
  let loadedDatasetId: DatasetId | null = null;
  const selectedIdsTable = 'vacp_react_dashboard_selected_ids';

  const ensureDuckDbLoaded = async (): Promise<void> => {
    await args.model.ensureDataset();
    const datasetId = args.model.getDatasetId();
    const dataset = args.model.getDataset();
    if (!dataset) throw new Error('No dataset loaded');
    if (loadedDatasetId === datasetId) return;
    const db = await duckdb;
    await db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    await db.loadObjectsAsTable(tableName, dataset.rows, { create: true });
    try {
      tableMeta = await getDuckDbTableMetadata({ duckdb: db, table: tableName });
    } catch {
      tableMeta = null;
    }
    loadedDatasetId = datasetId;
  };

  const sqlStringLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const syncSelectedIds = async (ids: string[]): Promise<void> => {
    const db = await duckdb;
    await ensureDuckDbLoaded();
    await db.exec(`CREATE TEMP TABLE IF NOT EXISTS ${selectedIdsTable}(id VARCHAR)`);
    await db.exec(`DELETE FROM ${selectedIdsTable}`);
    if (!ids.length) return;
    const values = ids.map((id) => `(${sqlStringLiteral(id)})`).join(',');
    await db.exec(`INSERT INTO ${selectedIdsTable} VALUES ${values}`);
  };

  const sql = createDuckDbSqlRouter({ duckdb });
  sql.addHandle({
    handleRef,
    getAllSql: async () => {
      await ensureDuckDbLoaded();
      return `SELECT * FROM ${tableName}`;
    },
    getSelectedSql: async () => {
      await ensureDuckDbLoaded();
      const { ids } = getEffectiveSelectedIds(args.model);
      await syncSelectedIds(ids);
      return ids.length
        ? `SELECT t.* FROM ${tableName} t JOIN ${selectedIdsTable} s USING(id)`
        : `SELECT * FROM ${tableName}`;
    },
  });
  actions.standard.dataSql(sql.handler, {
    targetRef: handleRef,
    description: 'Query the current dataset via DuckDB SQL.',
  });

  const graph: VacpGraphBase = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      { ref: viewRef, kind: 'View', layer: 'ViewLayer', title },
      { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title },
      {
        ref: scatterVizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'scatter view',
        description: 'Scatterplot view (recharts).',
      },
      {
        ref: brushVizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'brush view',
        description: 'Rank plot + brush view (recharts).',
      },
      {
        ref: scatterRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'scatter',
        description: 'recharts scatterplot',
      },
      {
        ref: rankPlotRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'rank plot',
        description: 'recharts rank plot of x (sorted) + brush.',
      },
      {
        ref: selectionRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'selected ids',
        description: 'Explicit point selection (by clicking points).',
      },
      {
        ref: lassoRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'lasso',
        description: 'Lasso polygon selection (x/y data space).',
      },
      {
        ref: brushRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'brush',
        description: 'Index range over rows sorted by the current x encoding.',
      },
      {
        ref: handleRef,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: 'rows (DuckDB handle)',
        description: 'Query `vacp_all` and `vacp_handle` via `vacp.data_sql`.',
        data: { primaryKey: 'id', tableName },
      },
    ],
    edges: [
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: scatterVizRef, kind: 'contains' },
      { from: vizRef, to: brushVizRef, kind: 'contains' },
      { from: scatterVizRef, to: scatterRef, kind: 'contains' },
      { from: scatterVizRef, to: selectionRef, kind: 'contains' },
      { from: scatterVizRef, to: lassoRef, kind: 'contains' },
      { from: brushVizRef, to: rankPlotRef, kind: 'contains' },
      { from: brushVizRef, to: brushRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
      { from: selectionRef, to: handleRef, kind: 'controls' },
      { from: lassoRef, to: handleRef, kind: 'controls' },
      { from: brushRef, to: handleRef, kind: 'controls' },
    ],
  };

  const vacp = createVacpLayer({
    globalKey: args.globalKey,
    graph,
    actions: actions.registry,
    getState: () => {
      const datasetId = args.model.getDatasetId();
      const dataset = args.model.getDataset();
      const encoding = args.model.getEncoding();
      const selectedIds = args.model.getSelectedIds();
      const brush = args.model.getBrush();
      const { ids, meaning } = getEffectiveSelectedIds(args.model);
      return {
        [scatterRef]: { kind: 'Mark', datasetId, x: encoding.x, y: encoding.y, color: encoding.color },
        [rankPlotRef]: { kind: 'Mark', datasetId, x: encoding.x, y: encoding.x },
        [selectionRef]: { kind: 'Selection', value: selectedIds },
        [lassoRef]: { kind: 'Selection', x: encoding.x, y: encoding.y, value: args.model.getLassoPolygon() ?? null },
        [brushRef]: {
          kind: 'Selection',
          x: encoding.x,
          startIndex: brush?.startIndex ?? null,
          endIndex: brush?.endIndex ?? null,
        },
        [handleRef]: {
          kind: 'DataHandle',
          tableName,
          datasetId,
          allCount: dataset?.rows.length ?? 0,
          selectedCount: ids.length,
          selectedMeaning: meaning,
          duckdb: tableMeta ?? undefined,
        },
      };
    },
  });

  return {
    ...vacp,
    refs: {
      viewRef,
      vizRef,
      scatterVizRef,
      brushVizRef,
      scatterRef,
      rankPlotRef,
      selectionRef,
      lassoRef,
      brushRef,
      handleRef,
    } as Record<string, VacpRef>,
  };
}
