/**
 * VACP integration layer.
 *
 * This file adds an agent-facing contract on top of the vanilla scatterplot:
 * - capabilities/state snapshots (`window.__vacp`)
 * - semantic actions (toggle/clear/apply_state)
 * - DuckDB access via the standard `vacp.data_sql` action
 */

import type { VacpGraphBase } from '@vacp/kit';
import {
  createDuckDbSqlRouter,
  createVacpActions,
  createVacpLayer,
  createVacpRefBuilder,
  makeVacpDuckDbTableName,
} from '@vacp/kit';
import { createDuckDbWasmClient, getDuckDbTableMetadata } from '@vacp/duckdb';
import { VACP_SCHEMA_VERSION, type VacpRef } from '@vacp/core';
import { buildVanillaMinimalPlaybooks } from './playbooks';

import type { Datum } from './plot';

export async function installVacpForVanillaScatter(args: {
  root: HTMLElement;
  svg: SVGSVGElement;
  globalKey: string;
  data: Datum[];
  selectedIds: Set<number>;
  onSetSelectedIds: (ids: number[]) => void;
}) {
  const appId = 'vacp-examples';
  const viewId = 'vanilla/minimal';
  const vizId = 'scatter';

  const viewRefs = createVacpRefBuilder({ appId, viewId });
  const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });
  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;
  const selectionRef = vizRefs.ref('/selection/points');
  const handleRef = vizRefs.ref('/data/points');

  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_vanilla_points' });
  let tableMeta: Awaited<ReturnType<typeof getDuckDbTableMetadata>> | null = null;

  // DuckDB is the single, uniform "data access" mechanism in this repo.
  // Initialize it lazily so the bridge (`window.__vacp`) becomes available immediately
  // even if the WASM bundle takes time to load.
  const duckdb = (async () => {
    const db = await createDuckDbWasmClient({ log: false });
    await db.loadObjectsAsTable(
      tableName,
      args.data.map((d) => ({ id: d.id, x: d.x, y: d.y, group: d.group })),
      { create: true },
    );
    try {
      tableMeta = await getDuckDbTableMetadata({ duckdb: db, table: tableName });
    } catch {
      // ignore: metadata is best-effort
    }
    return db;
  })();

  const actions = createVacpActions();

  actions
    .action('vanilla.toggle_point', 'Toggle a point id in the current selection.')
    .target(selectionRef)
    .params({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] })
    .handle((params) => {
      const id = (params as any)?.id;
      if (typeof id !== 'number' || !Number.isFinite(id)) throw new Error('Expected integer params.id');
      if (args.selectedIds.has(id)) args.selectedIds.delete(id);
      else args.selectedIds.add(id);
      return { selectedIds: Array.from(args.selectedIds) };
    });

  actions
    .action('vanilla.clear_selection', 'Clear the current selection.')
    .target(selectionRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.selectedIds.clear();
      return { selectedIds: [] };
    });

  actions.standard.applyState(
    (state) => {
      const rec = state[selectionRef as unknown as string];
      const v = rec && typeof rec === 'object' ? ((rec as any).value ?? rec) : rec;
      const ids = Array.isArray(v) ? v : [];
      args.onSetSelectedIds(ids.filter((x) => typeof x === 'number' && Number.isFinite(x)) as number[]);
      return { selectedIds: Array.from(args.selectedIds) };
    },
    { targetRef: selectionRef, description: 'Apply selection state (selected ids).' },
  );

  const sql = createDuckDbSqlRouter({ duckdb });
  sql.addHandle({
    handleRef,
    getAllSql: () => `SELECT * FROM ${tableName}`,
    getSelectedSql: () =>
      args.selectedIds.size
        ? `SELECT * FROM ${tableName} WHERE id IN (${Array.from(args.selectedIds).join(',')})`
        : `SELECT * FROM ${tableName}`,
  });
  actions.standard.dataSql(sql.handler, {
    targetRef: handleRef,
    description:
      'Query the selected points via DuckDB SQL (fallback: prefer semantic interaction actions when possible).',
  });

  const graph: VacpGraphBase = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      { ref: viewRef, kind: 'View', layer: 'ViewLayer', title: 'Vanilla minimal' },
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

  const playbooks = buildVanillaMinimalPlaybooks({ handleRef });

  const vacp = createVacpLayer({
    globalKey: args.globalKey,
    graph,
    actions: actions.registry,
    playbooks,
    getState: () => ({
      [selectionRef]: { kind: 'Selection', value: Array.from(args.selectedIds) },
      [handleRef]: {
        kind: 'DataHandle',
        tableName,
        selectedCount: args.selectedIds.size,
        selectedMeaning: args.selectedIds.size ? 'rows whose id is selected' : 'all rows (empty selection)',
        duckdb: tableMeta ?? undefined,
      },
    }),
  });

  return { ...vacp, refs: { viewRef, vizRef, selectionRef, handleRef } as Record<string, VacpRef> };
}
