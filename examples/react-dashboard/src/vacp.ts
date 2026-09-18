import { exampleOptions } from '../../config';
/**
 * VACP integration layer.
 *
 * This module adds an agent-facing contract on top of the React dashboard:
 * - capabilities/state snapshots (`window.__vacp`, when bridge exposure is enabled)
 * - semantic actions (dataset/encoding/selection)
 * - DuckDB access via the standard `vacp.data_sql` action
 *
 * The dashboard implementation (React + zustand) stays VACP-agnostic.
 * The VACP layer receives a small model adapter (getters/setters), matching
 * the bring-your-own-provider examples.
 */

import { createVacpActions, createVacpProvider, createVacpRefBuilder, installVacp } from '@vacp/sdk';
import { createDuckDbSqlRouter, makeVacpDuckDbTableName, sqlStringLiteral } from '@vacp/data-duckdb';
import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { createDuckDbWasmClient, getDuckDbTableMetadata, type VacpDuckDbTableMetadata } from '@vacp/data-duckdb';
import { VACP_SCHEMA_VERSION, type VacpGraphFragment } from '@vacp/protocol';

import type { Dataset, DatasetId, Encoding } from './datasets/registry';
import { isDatasetId, listDatasets } from './datasets/registry';

export type ReactDashboardModel = {
  ensureDataset: () => Promise<void>;
  getDatasetId: () => DatasetId | null;
  getDataset: () => Dataset | null;
  setDatasetId: (id: DatasetId) => Promise<void>;
  getEncoding: () => Encoding;
  setEncoding: (patch: Partial<Encoding>) => void;
  getSelectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;
  toggleSelectedId: (id: string) => void;
  clearSelection: () => void;
  getBrush2d: () => { x0: number; x1: number; y0: number; y1: number } | null;
  setBrush2d: (brush: { x0: number; x1: number; y0: number; y1: number } | null) => void;
  clearBrush2d: () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getPropString(obj: Record<string, unknown> | null, key: string): string | null {
  const v = obj ? obj[key] : undefined;

  return typeof v === 'string' ? v : null;
}

function getPropArray(obj: Record<string, unknown> | null, key: string): unknown[] | null {
  const v = obj ? obj[key] : undefined;

  return Array.isArray(v) ? v : null;
}

function unwrapVacpValue(rec: unknown) {
  const obj = asRecord(rec);

  if (!obj) return rec;

  return obj.value !== undefined ? obj.value : rec;
}

function getEffectiveSelectedIds(model: ReactDashboardModel): { ids: string[]; meaning: string } {
  const dataset = model.getDataset();

  if (!dataset) return { ids: [], meaning: 'no dataset loaded' };

  const selectedIds = model.getSelectedIds();
  const brush2d = model.getBrush2d();

  if (selectedIds.length && brush2d) return { ids: selectedIds, meaning: '2d brush subset' };

  if (selectedIds.length) return { ids: selectedIds, meaning: 'explicit selection ids' };

  return { ids: [], meaning: 'no selection (fallback: all rows)' };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const clamped = Math.max(0, Math.min(1, q));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);

  if (lo === hi) return sorted[lo] ?? NaN;
  const loVal = sorted[lo] ?? NaN;
  const hiVal = sorted[hi] ?? NaN;
  const t = idx - lo;

  return loVal + (hiVal - loVal) * t;
}

function numericValues(dataset: Dataset, key: string): number[] {
  return dataset.rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

export function installVacpForReactDashboard(args: { globalKey?: string; title?: string; model: ReactDashboardModel }) {
  const appId = 'vacp-examples';
  const viewId = 'react/dashboard';
  const vizId = 'recharts';

  const title = args.title ?? 'React dashboard';

  const datasetCatalog = listDatasets().map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
  }));

  const datasetIds = datasetCatalog.map((entry) => entry.id);

  const viewRefs = createVacpRefBuilder({ appId, viewId });
  const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });
  const appRef = `vacp://${appId}`;
  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;

  const scatterVizRef = vizRefs.ref('/viz/scatter');
  const distributionVizRef = vizRefs.ref('/viz/distribution');
  const distributionXVizRef = vizRefs.ref('/viz/distribution/x');
  const distributionYVizRef = vizRefs.ref('/viz/distribution/y');
  const tableVizRef = vizRefs.ref('/viz/table');

  const scatterRef = vizRefs.ref('/viz/scatter/mark/scatter');
  const distributionXRef = vizRefs.ref('/viz/distribution/x/mark/pdf');
  const distributionYRef = vizRefs.ref('/viz/distribution/y/mark/pdf');
  const tableRef = vizRefs.ref('/viz/table/mark/table');

  const selectionRef = vizRefs.ref('/viz/scatter/selection/points');
  const brush2dRef = vizRefs.ref('/viz/scatter/selection/brush2d');
  const handleRef = vizRefs.ref('/data/rows');

  const actions = createVacpActions();

  actions
    .operation(
      'mutation',
      'dashboard.set_dataset',
      `Set the active dataset (loads JSON rows and rebuilds the DuckDB table). Valid ids: ${datasetIds.join(', ')}.`,
    )
    .affects(handleRef)
    .params({
      type: 'object',
      properties: { id: { type: 'string', enum: datasetIds } },
      required: ['id'],
    })
    .handle(async (params) => {
      const id = getPropString(asRecord(params), 'id') ?? '';

      if (!isDatasetId(id)) throw new Error(`Unknown dataset id: ${id}`);
      await args.model.setDatasetId(id);

      return { datasetId: id };
    });

  actions
    .operation('mutation', 'dashboard.set_encoding', 'Set x/y/color encodings for the scatterplot.')
    .affects(scatterRef)
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
      const color = p.color === null || typeof p.color === 'string' ? p.color : null;

      if (!x || !y) throw new Error('Expected params.x and params.y');
      args.model.setEncoding({ x, y, color });

      return { ok: true };
    });

  actions
    .operation('mutation', 'dashboard.set_selected_ids', 'Set the selected row ids (replaces current selection).')
    .affects(selectionRef)
    .params({ type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] })
    .handle((params) => {
      const ids = getPropArray(asRecord(params), 'ids') ?? [];
      args.model.setSelectedIds(ids.map(String));

      return { selectedCount: args.model.getSelectedIds().length };
    });

  actions
    .operation(
      'mutation',
      'dashboard.set_brush_2d',
      'Set a 2D rectangular brush in data space (x/y) and replace the selection.',
    )
    .affects(brush2dRef)
    .params({
      type: 'object',
      properties: {
        x0: { type: 'number' },
        x1: { type: 'number' },
        y0: { type: 'number' },
        y1: { type: 'number' },
      },
      required: ['x0', 'x1', 'y0', 'y1'],
    })
    .handle((params) => {
      const p = asRecord(params);
      const x0 = Number(p?.x0);
      const x1 = Number(p?.x1);
      const y0 = Number(p?.y0);
      const y1 = Number(p?.y1);

      if (![x0, x1, y0, y1].every((v) => Number.isFinite(v))) throw new Error('Expected numeric x0/x1/y0/y1');
      args.model.setBrush2d({ x0, x1, y0, y1 });

      return { brush2d: args.model.getBrush2d(), selectedCount: args.model.getSelectedIds().length };
    });

  actions
    .operation(
      'mutation',
      'dashboard.select_by_quantiles',
      'Select points within x/y quantile bounds of the current encoding for compact subset selection without hand-picking raw ranges.',
    )
    .affects(selectionRef)
    .params({
      type: 'object',
      properties: {
        xMinQ: { type: 'number', minimum: 0, maximum: 1 },
        xMaxQ: { type: 'number', minimum: 0, maximum: 1 },
        yMinQ: { type: 'number', minimum: 0, maximum: 1 },
        yMaxQ: { type: 'number', minimum: 0, maximum: 1 },
      },
    })
    .handle((params) => {
      const dataset = args.model.getDataset();
      const encoding = args.model.getEncoding();

      if (!dataset) throw new Error('No dataset loaded');

      if (!encoding.x || !encoding.y) throw new Error('Set x and y encoding before quantile selection');

      const p = asRecord(params) ?? {};
      const xMinQ = Number.isFinite(Number(p.xMinQ)) ? Number(p.xMinQ) : 0;
      const xMaxQ = Number.isFinite(Number(p.xMaxQ)) ? Number(p.xMaxQ) : 0.35;
      const yMinQ = Number.isFinite(Number(p.yMinQ)) ? Number(p.yMinQ) : 0;
      const yMaxQ = Number.isFinite(Number(p.yMaxQ)) ? Number(p.yMaxQ) : 0.35;

      const xVals = numericValues(dataset, encoding.x);
      const yVals = numericValues(dataset, encoding.y);

      if (!xVals.length || !yVals.length) throw new Error('Current encoding fields are not numeric');

      const x0 = quantile(xVals, Math.min(xMinQ, xMaxQ));
      const x1 = quantile(xVals, Math.max(xMinQ, xMaxQ));
      const y0 = quantile(yVals, Math.min(yMinQ, yMaxQ));
      const y1 = quantile(yVals, Math.max(yMinQ, yMaxQ));
      args.model.setBrush2d({ x0, x1, y0, y1 });

      return {
        brush2d: args.model.getBrush2d(),
        selectedCount: args.model.getSelectedIds().length,
        quantiles: { xMinQ, xMaxQ, yMinQ, yMaxQ },
      };
    });

  actions
    .operation('mutation', 'dashboard.clear_brush_2d', 'Clear the 2D brush and clear the selection.')
    .affects(brush2dRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.model.clearBrush2d();

      return { ok: true };
    });

  actions
    .operation('mutation', 'dashboard.toggle_selected_id', 'Toggle one row id in the selection.')
    .affects(selectionRef)
    .params({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] })
    .handle((params) => {
      const id = getPropString(asRecord(params), 'id') ?? '';

      if (!id) throw new Error('Expected params.id');
      args.model.toggleSelectedId(id);

      return { selectedCount: args.model.getSelectedIds().length };
    });

  actions
    .operation('mutation', 'dashboard.clear_selection', 'Clear the explicit point selection.')
    .affects(selectionRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.model.clearSelection();

      return { ok: true };
    });

  actions.standard.applyState(
    async (state) => {
      let applied = 0;

      // Scatter encodings (+ optional dataset switch).
      {
        const rec = state[scatterRef];
        const obj = rec && typeof rec === 'object' ? (rec as Record<string, unknown>) : null;

        if (obj) {
          const datasetId = typeof obj.datasetId === 'string' ? obj.datasetId : null;

          if (datasetId && isDatasetId(datasetId)) {
            await args.model.setDatasetId(datasetId);
            applied += 1;
          }

          const patch: Partial<Encoding> = {};

          if (obj.x === null || typeof obj.x === 'string') patch.x = obj.x;

          if (obj.y === null || typeof obj.y === 'string') patch.y = obj.y;

          if (obj.color === null || typeof obj.color === 'string') patch.color = obj.color;

          if (Object.keys(patch).length) {
            args.model.setEncoding(patch);
            applied += 1;
          }
        }
      }

      // Selection ids.
      {
        const rec = state[selectionRef];

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

      // 2D brush selection (applied last so it "wins" over selection ids).
      {
        const rec = state[brush2dRef];

        if (rec !== undefined) {
          const raw = rec && typeof rec === 'object' ? (rec as Record<string, unknown>) : null;

          const obj =
            raw && raw.value && typeof raw.value === 'object' && !Array.isArray(raw.value)
              ? (raw.value as Record<string, unknown>)
              : raw;

          const x0 = obj ? Number(obj.x0) : NaN;
          const x1 = obj ? Number(obj.x1) : NaN;
          const y0 = obj ? Number(obj.y0) : NaN;
          const y1 = obj ? Number(obj.y1) : NaN;

          if (![x0, x1, y0, y1].every((v) => Number.isFinite(v))) {
            args.model.clearBrush2d();
            applied += 1;
          } else {
            args.model.setBrush2d({ x0, x1, y0, y1 });
            applied += 1;
          }
        }
      }

      return { applied };
    },
    { affects: [vizRef], description: 'Apply dashboard state (dataset/encoding/selection).' },
  );

  // DuckDB: one table for the active dataset + a temp table for effective ids.
  const duckdb = createDuckDbWasmClient({ log: false });
  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_react_dashboard_rows' });
  let tableMeta: VacpDuckDbTableMetadata | null = null;
  let loadedDatasetId: DatasetId | null = null;
  let duckDbLoad: Promise<void> | null = null;
  const selectedIdsTable = 'vacp_react_dashboard_selected_ids';

  const ensureDuckDbLoaded = async (): Promise<void> => {
    while (true) {
      await args.model.ensureDataset();
      const datasetId = args.model.getDatasetId();

      if (!datasetId) throw new Error('No dataset selected');
      const dataset = args.model.getDataset();

      if (!dataset) throw new Error('No dataset loaded');

      if (duckDbLoad) {
        await duckDbLoad;
        continue;
      }

      if (loadedDatasetId === datasetId) return;

      const load = (async () => {
        const db = await duckdb;
        await db.exec(`DROP TABLE IF EXISTS ${tableName}`);
        await db.loadObjectsAsTable(tableName, dataset.rows, { create: true });

        try {
          tableMeta = await getDuckDbTableMetadata({
            duckdb: db,
            table: tableName,
            sampleRows: 0,
            maxNumericColumns: 0,
            maxTemporalColumns: 0,
            maxCategoricalColumns: 0,
          });
        } catch {
          tableMeta = null;
        }

        loadedDatasetId = datasetId;
      })();

      duckDbLoad = load;

      try {
        await load;
      } finally {
        if (duckDbLoad === load) duckDbLoad = null;
      }
    }
  };

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
    enabled: exampleOptions.enableSql,
    inputRefs: [handleRef],
    description: 'Query the current dataset via DuckDB SQL.',
  });

  actions.standard.dataSchema(
    async (params) => {
      if (params.handleRef !== handleRef) throw new Error(`Unknown DataHandle: ${params.handleRef}`);
      await ensureDuckDbLoaded();
      const db = await duckdb;
      const detail = params.detail ?? 'columns';
      const sampleRows = params.sampleRows;

      const meta = await getDuckDbTableMetadata({
        duckdb: db,
        table: tableName,
        sampleRows: detail === 'full' ? (sampleRows ?? 25_000) : 0,
        maxNumericColumns: detail === 'full' ? undefined : 0,
        maxTemporalColumns: detail === 'full' ? undefined : 0,
        maxCategoricalColumns: detail === 'full' ? undefined : 0,
      });

      return { handleRef, detail, ...meta };
    },
    {
      inputRefs: [handleRef],
      description: 'Return schema/metadata for the current dataset (columns, types, row count, optional summaries).',
    },
  );

  const graph: Omit<VacpGraphFragment, 'actions'> = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      { ref: appRef, kind: 'App', layer: 'ViewLayer', title: 'VACP examples' },
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
        ref: distributionVizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'distribution view',
        description: 'Distribution view (PDF histograms for x/y).',
      },
      {
        ref: distributionXVizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'distribution (x)',
        description: 'PDF histogram for the x encoding.',
      },
      {
        ref: distributionYVizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'distribution (y)',
        description: 'PDF histogram for the y encoding.',
      },
      {
        ref: tableVizRef,
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'table view',
        description: 'Tabular view of rows (TanStack Table).',
      },
      {
        ref: scatterRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'scatter',
        description: 'recharts scatterplot',
      },
      {
        ref: distributionXRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'pdf (x)',
        description: 'Estimated PDF for the x encoding.',
      },
      {
        ref: distributionYRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'pdf (y)',
        description: 'Estimated PDF for the y encoding.',
      },
      {
        ref: tableRef,
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'data table',
        description: 'Rows rendered in a table.',
      },
      {
        ref: selectionRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'selected ids',
        description: 'Explicit point selection (by clicking points).',
      },
      {
        ref: brush2dRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'brush 2d',
        description: '2D rectangular brush selection (x/y data space).',
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
      { from: appRef, to: viewRef, kind: 'contains' },
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: scatterVizRef, kind: 'contains' },
      { from: vizRef, to: distributionVizRef, kind: 'contains' },
      { from: vizRef, to: tableVizRef, kind: 'contains' },
      { from: scatterVizRef, to: scatterRef, kind: 'contains' },
      { from: scatterVizRef, to: selectionRef, kind: 'contains' },
      { from: scatterVizRef, to: brush2dRef, kind: 'contains' },
      { from: distributionVizRef, to: distributionXVizRef, kind: 'contains' },
      { from: distributionVizRef, to: distributionYVizRef, kind: 'contains' },
      { from: distributionXVizRef, to: distributionXRef, kind: 'contains' },
      { from: distributionYVizRef, to: distributionYRef, kind: 'contains' },
      { from: tableVizRef, to: tableRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
      { from: selectionRef, to: handleRef, kind: 'controls' },
      { from: brush2dRef, to: handleRef, kind: 'controls' },
    ],
  };

  const provider = createVacpProvider({
    source: {
      id: `vacp-source://${appId}/${viewId}/${vizId}/react-dashboard`,
      type: 'react-dashboard',
      title: 'React analytics dashboard',
    },
    actions: actions.registry,
    project: () => {
      const state = (() => {
        const datasetId = args.model.getDatasetId();
        const encoding = args.model.getEncoding();
        const selectedIds = args.model.getSelectedIds();
        const brush2d = args.model.getBrush2d();

        return {
          [scatterRef]: { kind: 'Mark', datasetId, x: encoding.x, y: encoding.y, color: encoding.color },
          [distributionXRef]: { kind: 'Mark', datasetId, view: 'pdf', axis: 'x', field: encoding.x },
          [distributionYRef]: { kind: 'Mark', datasetId, view: 'pdf', axis: 'y', field: encoding.y },
          [tableRef]: { kind: 'Mark', datasetId },
          [selectionRef]: { kind: 'Selection', value: selectedIds },
          [brush2dRef]: {
            kind: 'Selection',
            x: encoding.x,
            y: encoding.y,
            x0: brush2d?.x0 ?? null,
            x1: brush2d?.x1 ?? null,
            y0: brush2d?.y0 ?? null,
            y1: brush2d?.y1 ?? null,
          },
          [handleRef]: {
            kind: 'DataHandle',
            tableName,
            datasetId,
          },
        };
      })();
      const summary = (() => {
        const dataset = args.model.getDataset();
        const datasetId = args.model.getDatasetId();
        const encoding = args.model.getEncoding();
        const { ids, meaning } = getEffectiveSelectedIds(args.model);

        const xStats =
          dataset && encoding.x
            ? (() => {
                const vals = numericValues(dataset, encoding.x);

                if (!vals.length) return undefined;

                return {
                  field: encoding.x,
                  min: vals[0],
                  max: vals[vals.length - 1],
                  q1: quantile(vals, 0.25),
                  median: quantile(vals, 0.5),
                  q3: quantile(vals, 0.75),
                };
              })()
            : undefined;

        const yStats =
          dataset && encoding.y
            ? (() => {
                const vals = numericValues(dataset, encoding.y);

                if (!vals.length) return undefined;

                return {
                  field: encoding.y,
                  min: vals[0],
                  max: vals[vals.length - 1],
                  q1: quantile(vals, 0.25),
                  median: quantile(vals, 0.5),
                  q3: quantile(vals, 0.75),
                };
              })()
            : undefined;

        return {
          [viewRef]: {
            availableDatasets: datasetCatalog,
            activeDatasetId: datasetId,
            activeEncoding: encoding,
            selectionHint:
              xStats && yStats
                ? {
                    strategy: 'lower-quartile-cluster',
                    x0: xStats.min,
                    x1: xStats.q1,
                    y0: yStats.min,
                    y1: yStats.q1,
                  }
                : undefined,
          },
          [handleRef]: {
            allCount: dataset?.rows.length ?? 0,
            selectedCount: ids.length,
            selectedMeaning: meaning,
            duckdb: tableMeta ?? undefined,
          },
        };
      })();
      return { graph, state, summary };
    },
  });
  const vacp = installVacp({
    globalKey: args.globalKey,
    exposeBridge: exampleOptions.exposeBridge,
    injectDomSnapshot: exampleOptions.injectDomSnapshot,
    providers: [provider],
  });

  // Optional analytics: if PostHog is configured, stream VACP history into the session replay.
  const posthogApiKey = import.meta.env.VACP_POSTHOG_API_KEY as string | undefined;

  if (posthogApiKey) {
    const posthogDefaults = import.meta.env.VACP_POSTHOG_DEFAULTS as string | undefined;
    const captureSnapshots = (import.meta.env.VACP_POSTHOG_CAPTURE_SNAPSHOTS as string | undefined) === '1';
    installVacpPosthogAnalytics({
      bridge: vacp.bridge,
      posthog: {
        apiKey: posthogApiKey,
        apiHost: import.meta.env.VACP_POSTHOG_API_HOST as string | undefined,
        config: posthogDefaults
          ? { defaults: posthogDefaults as NonNullable<VacpPosthogOptions['config']>['defaults'] }
          : undefined,
      },
      analytics: {
        getBaseProperties: () => ({ vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: vizId }),
        captureSnapshots,
      },
    });
  }

  return {
    ...vacp,
    refs: {
      appRef,
      viewRef,
      vizRef,
      scatterVizRef,
      distributionVizRef,
      distributionXVizRef,
      distributionYVizRef,
      tableVizRef,
      scatterRef,
      distributionXRef,
      distributionYRef,
      tableRef,
      selectionRef,
      brush2dRef,
      handleRef,
    },
  };
}
