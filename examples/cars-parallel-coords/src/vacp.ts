import { z } from 'zod';
import type { VacpDataHandleState, VacpDataSchemaColumn, VacpGraphFragment, VacpRef } from '@ethivia/vacp-protocol';
import {
  createVacpProvider,
  registerVacpApplyStateAction,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
  type VacpRuntime,
} from '@ethivia/vacp-runtime';
import { createVacpActions, createVacpRefBuilder } from '@ethivia/vacp-sdk';
import {
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  describeDuckDbTable,
  makeVacpDuckDbTableName,
  sqlIdentifier,
} from '@ethivia/vacp-data-duckdb';
import { exampleDuckDbBundles, installExampleRuntime } from '@ethivia/vacp-example-shared';
import { exampleOptions } from '@ethivia/vacp-example-shared/config';
import { elementPresenceTarget, observePresenceLayout, svgPresenceTarget } from '@ethivia/vacp-presence-core/dom';
import type { BrushRange, CarDatum, ParallelCoordsChart } from './chart';

function numberExtent(data: CarDatum[], dim: string): BrushRange {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;

  for (const d of data) {
    const n = Number(d[dim]);

    if (!Number.isFinite(n)) continue;
    lo = Math.min(lo, n);
    hi = Math.max(hi, n);
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 0];

  return lo <= hi ? [lo, hi] : [hi, lo];
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9;
}

/** Expose the chart's brushes, axis order, hover, and rows through VACP for the lifetime of `signal`. */
export async function connectVacp(args: {
  chart: ParallelCoordsChart;
  root: HTMLElement;
  title: string;
  data: CarDatum[];
  dimensions: string[];
  signal: AbortSignal;
}): Promise<VacpRuntime> {
  const { chart, root, data, dimensions, signal } = args;
  const appId = 'vacp-examples';
  const viewId = 'vanilla/cars-parallel-coords';
  const vizId = 'parallel-coords';

  const viewRefs = createVacpRefBuilder({ appId, viewId });
  const vizRefs = createVacpRefBuilder({ appId, viewId, vizId });
  const viewRef = viewRefs.root;
  const vizRef = vizRefs.root;
  const brushRef = vizRefs.ref('/selection/brushes');
  const orderRef = vizRefs.ref('/param/dimension_order');
  const hoverRef = vizRefs.ref('/selection/hover');
  const handleRef = vizRefs.ref('/data/cars');

  const extents = Object.fromEntries(dimensions.map((d) => [d, numberExtent(data, d)]));

  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_cars_parallel_coords' });
  let columns: VacpDataSchemaColumn[] | undefined;

  const duckdb = createDuckDbWasmClient({ log: false, bundles: exampleDuckDbBundles }).then(async (db) => {
    await db.loadObjectsAsTable(tableName, data, {});
    columns = (await describeDuckDbTable({ duckdb: db, table: tableName }).catch(() => null))?.columns;
    return db;
  });
  signal.addEventListener(
    'abort',
    () => void duckdb.then((db) => db.dispose()).catch((error) => console.error('Cars data cleanup failed', error)),
    { once: true },
  );

  const actions = createVacpActions();

  const dimension = z.enum(dimensions);
  const brushRange = z
    .tuple([z.coerce.number(), z.coerce.number()])
    .transform(([a, b]): BrushRange => (a <= b ? [a, b] : [b, a]))
    .nullable();

  actions
    .operation(
      'mutation',
      'parallel_coords.set_brush_ranges',
      'Set one or more per-axis brush ranges (data units). Use null to clear.',
    )
    .title('Filter cars')
    .affects(brushRef)
    .params(z.object({ ranges: z.partialRecord(dimension, brushRange) }))
    .focus(({ ranges }) => ({ ref: brushRef, detail: { ranges } }))
    .handle(({ ranges }) => {
      chart.setBrushRanges(ranges);

      return { selectedCount: chart.getState().selectedCount };
    });

  actions
    .operation('mutation', 'parallel_coords.reset_brushes', 'Reset all brushes to the full data extents.')
    .affects(brushRef)
    .params(z.object({}).default({}))
    .focus(() => ({ ref: brushRef }))
    .handle(() => {
      chart.resetBrushes();

      return { ok: true, selectedCount: chart.getState().selectedCount };
    });

  actions
    .operation('mutation', 'parallel_coords.set_dimension_order', 'Set the axis order as an array of dimension names.')
    .affects(orderRef)
    .params(z.object({ order: z.array(z.coerce.string()) }))
    .handle(({ order }) => {
      chart.setDimensionOrder(order);

      return { ok: true };
    });

  actions
    .operation('mutation', 'parallel_coords.reset_dimension_order', 'Reset axis order back to the dataset default.')
    .affects(orderRef)
    .params(z.object({}).default({}))
    .handle(() => {
      chart.resetDimensionOrder();

      return { ok: true };
    });

  actions
    .operation(
      'mutation',
      'parallel_coords.set_hover',
      'Hover the line of one selected car and show its tooltip, or pass null to clear the hover. Find the row id with SQL over the cars handle.',
    )
    .affects(hoverRef)
    .params(z.object({ id: z.number().int().nullable().describe('Row id of a car inside every brush, or null.') }))
    .handle(({ id }) => {
      const row = id === null ? null : data.find((d) => d.id === id);
      if (row === undefined || (row && !chart.getSelectedIds().includes(row.id)))
        throw new Error(`No selected row with id=${id}`);
      chart.setHoveredId(id);

      return { ok: true, row };
    });

  const brushState = z.object({
    ranges: z.record(
      dimension,
      z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo <= hi, 'Brush ranges run from low to high'),
    ),
  });
  const orderState = z.object({
    value: z
      .array(dimension)
      .length(dimensions.length)
      .refine((order) => new Set(order).size === order.length, 'Axis order names every dimension once'),
  });
  const hoverState = z.object({ hoveredId: z.number().int().nullable() });

  registerVacpApplyStateAction(
    actions.registry,
    (state) => {
      const owned = new Set<string>([brushRef, orderRef, hoverRef, handleRef]);
      for (const ref of Object.keys(state))
        if (!owned.has(ref)) throw new Error(`Unknown parallel coordinates state: ${ref}`);
      const read = <Schema extends z.ZodType>(ref: VacpRef, schema: Schema): z.output<Schema> | undefined =>
        state[ref] === undefined ? undefined : schema.parse(state[ref]);
      const brushes = read(brushRef, brushState);
      const order = read(orderRef, orderState);
      const hover = read(hoverRef, hoverState);
      return () => {
        if (order) chart.setDimensionOrder(order.value);
        if (brushes) chart.setBrushRanges(brushes.ranges);
        if (hover) chart.setHoveredId(hover.hoveredId);
        return {
          applied: [order ? [orderRef] : [], brushes ? [brushRef] : [], hover ? [hoverRef] : []].flat(),
          // The handle's state follows the brushes, so restoring them restores it.
          skipped: state[handleRef] === undefined ? [] : [handleRef],
        };
      };
    },
    { affects: [vizRef], description: 'Apply brush ranges, axis order, and hover state.' },
  );

  /** The brush ranges as a predicate over the table, or null while every axis spans its full extent. */
  const brushWhere = (): string | null => {
    const st = chart.getState();
    const preds: string[] = [];

    for (const dim of st.dimensions) {
      const range = st.brushRanges[dim];
      const full = extents[dim];

      if (!range || !full) continue;

      if (nearlyEqual(range[0], full[0]) && nearlyEqual(range[1], full[1])) continue;
      preds.push(`(${sqlIdentifier(dim)} >= ${range[0]} AND ${sqlIdentifier(dim)} <= ${range[1]})`);
    }

    return preds.length ? preds.join(' AND ') : null;
  };

  const sql = createDuckDbDataSqlHandler({
    duckdb,
    resolveHandle: (ref) => {
      if (ref !== handleRef) return null;
      const allSql = `SELECT * FROM ${tableName}`;
      const where = brushWhere();
      return { allSql, selectedSql: where ? `${allSql} WHERE ${where}` : allSql };
    },
  });
  if (exampleOptions.enableSql)
    registerVacpDataSqlAction(actions.registry, sql, {
      inputRefs: [handleRef],
      description: 'Query the cars with DuckDB SQL. `vacp_handle` holds the cars inside every brush.',
    });

  registerVacpDataSchemaAction(
    actions.registry,
    createDuckDbDataSchemaHandler({
      duckdb,
      resolveHandle: (ref) => (ref === handleRef ? { table: tableName } : null),
    }),
    { inputRefs: [handleRef], description: 'Return the columns, types, and row count of the cars table.' },
  );

  const graph: VacpGraphFragment = {
    actions: actions.registry.list(),
    nodes: [
      { ref: viewRef, kind: 'View', layer: 'ViewLayer', title: args.title },
      { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Parallel coordinates (SVG)' },
      {
        ref: brushRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'Brush ranges',
        description: 'Per-axis brush ranges in data units.',
        data: { type: 'intervals', dimensions },
      },
      {
        ref: orderRef,
        kind: 'Param',
        layer: 'ConfigLayer',
        title: 'dimension_order',
        description: 'Axis order from left to right.',
        data: { type: 'string[]' },
      },
      {
        ref: hoverRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'Hover focus',
        description: 'Currently hovered line (tooltip focus).',
        data: { type: 'point', key: 'id' },
      },
      {
        ref: handleRef,
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: 'cars (DuckDB handle)',
        description: 'The cars table. `vacp_handle` holds the cars inside every brush, and `vacp_all` every car.',
        data: { table: tableName },
      },
    ],
    edges: [
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: brushRef, kind: 'contains' },
      { from: vizRef, to: orderRef, kind: 'contains' },
      { from: vizRef, to: hoverRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
      { from: brushRef, to: handleRef, kind: 'controls' },
    ],
  };

  const provider = createVacpProvider({
    source: {
      id: `vacp-source://${appId}/${viewId}/${vizId}/parallel-coordinates`,
      type: 'parallel-coordinates',
      title: args.title,
    },
    actions: actions.registry,
    subscribe: (invalidate) => chart.subscribe(invalidate),
    project: () => {
      const st = chart.getState();

      const state = {
        [brushRef]: {
          kind: 'Selection',
          ranges: st.brushRanges,
          selectedCount: st.selectedCount,
          totalCount: st.totalCount,
        },
        [orderRef]: { kind: 'Param', value: st.dimensionOrder },
        [hoverRef]: {
          kind: 'Selection',
          hoveredId: st.hoveredId,
          hoveredCar: st.hoveredId === null ? null : (data.find((d) => d.id === st.hoveredId)?.Car ?? null),
        },
        [handleRef]: {
          kind: 'DataHandle',
          rowCount: st.totalCount,
          selectionWhere: brushWhere(),
        } satisfies VacpDataHandleState,
      } satisfies Record<VacpRef, unknown>;
      const nodes = columns
        ? graph.nodes.map((node) => (node.ref === handleRef ? { ...node, data: { table: tableName, columns } } : node))
        : graph.nodes;
      return { graph: { ...graph, nodes }, state };
    },
  });

  const focusRanges = z.object({ ranges: z.record(z.string(), z.tuple([z.number(), z.number()]).nullable()) });
  return installExampleRuntime({
    sources: [
      {
        provider,
        presentation: {
          resolve: (focus) => {
            if (focus.ref !== brushRef) return null;
            const parsed = focusRanges.safeParse(focus.detail);
            const first = parsed.success
              ? Object.entries(parsed.data.ranges).find(([, range]) => range !== null)
              : undefined;
            if (first?.[1]) {
              const bounds = chart.getBrushBounds(first[0], first[1]);
              if (bounds)
                return svgPresenceTarget(bounds.element, {
                  kind: 'region',
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                });
            }
            return elementPresenceTarget(root);
          },
          subscribe: (invalidate) => observePresenceLayout(root, invalidate),
        },
      },
    ],
    root,
    sessionKey: viewId,
    analytics: { vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: vizId },
    signal,
  });
}
