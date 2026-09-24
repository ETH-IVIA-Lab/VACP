import { elementPresenceTarget, observePresenceLayout, svgPresenceTarget } from '@vacp/presence-browser';
import { createExamplePresence, exampleDuckDbBundles } from '@vacp/example-shared';
import { exampleOptions } from '../../config';
import { z } from 'zod';

import { createVacpActions, createVacpProvider, createVacpRefBuilder, installVacp } from '@vacp/sdk';
import { createDuckDbSqlRouter, makeVacpDuckDbTableName, sqlIdentifier } from '@vacp/data-duckdb';
import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { createDuckDbWasmClient, getDuckDbTableMetadata, type VacpDuckDbTableMetadata } from '@vacp/data-duckdb';
import { VACP_SCHEMA_VERSION, type VacpGraphFragment, type VacpRef } from '@vacp/protocol';

import type { BrushRange, CarDatum, ParallelCoordsSource } from './chart';
import type { ParallelCoordsState } from './chart';

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

export function installVacpForCarsParallelCoords(args: {
  root: HTMLElement;
  globalKey?: string;
  title: string;
  data: CarDatum[];
  dimensions: string[];
  getState: () => ParallelCoordsState;
  getBrushBounds: (
    dimension: string,
    range: BrushRange,
  ) => { element: SVGGraphicsElement; x: number; y: number; width: number; height: number } | null;
  getSelectedIds: () => number[];
  setBrushRanges: (ranges: Partial<Record<string, BrushRange | null>>, source: ParallelCoordsSource) => void;
  resetBrushes: (source: ParallelCoordsSource) => void;
  setDimensionOrder: (order: string[], source: ParallelCoordsSource) => void;
  resetDimensionOrder: (source: ParallelCoordsSource) => void;
  setHoveredId: (id: number | null, source: ParallelCoordsSource) => void;
}) {
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

  const extents = Object.fromEntries(args.dimensions.map((d) => [d, numberExtent(args.data, d)]));

  const tableName = makeVacpDuckDbTableName({ prefix: 'vacp_cars_parallel_coords' });
  let tableMeta: VacpDuckDbTableMetadata | null = null;

  const duckdb = (async () => {
    const db = await createDuckDbWasmClient({ log: false, bundles: exampleDuckDbBundles });
    await db.loadObjectsAsTable(tableName, args.data, { create: true });

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

    return db;
  })();

  const actions = createVacpActions();

  const brushRange = z
    .tuple([z.coerce.number(), z.coerce.number()])
    .transform(([a, b]): BrushRange => (a <= b ? [a, b] : [b, a]))
    .nullable();
  const brushParams = z.object({ ranges: z.partialRecord(z.enum(args.dimensions), brushRange) });
  const parseRange = (value: unknown): BrushRange | null => {
    const parsed = brushRange.safeParse(value);
    return parsed.success ? parsed.data : null;
  };

  actions
    .operation(
      'mutation',
      'parallel_coords.set_brush_ranges',
      'Set one or more per-axis brush ranges (data units). Use null to clear.',
    )
    .title('Filter cars')
    .affects(brushRef)
    .params(brushParams)
    .focus(({ ranges }) => ({ ref: brushRef, detail: { ranges } }))
    .handle(({ ranges }) => {
      args.setBrushRanges(ranges, 'agent');

      return { selectedCount: args.getState().selectedCount };
    });

  actions
    .operation('mutation', 'parallel_coords.reset_brushes', 'Reset all brushes to the full data extents.')
    .affects(brushRef)
    .params(z.object({}).default({}))
    .focus(() => ({ ref: brushRef }))
    .handle(() => {
      args.resetBrushes('agent');

      return { ok: true, selectedCount: args.getState().selectedCount };
    });

  actions
    .operation('mutation', 'parallel_coords.set_dimension_order', 'Set the axis order as an array of dimension names.')
    .affects(orderRef)
    .params(z.object({ order: z.array(z.coerce.string()) }))
    .handle(({ order }) => {
      args.setDimensionOrder(order, 'agent');

      return { ok: true };
    });

  actions
    .operation('mutation', 'parallel_coords.reset_dimension_order', 'Reset axis order back to the dataset default.')
    .affects(orderRef)
    .params(z.object({}).default({}))
    .handle(() => {
      args.resetDimensionOrder('agent');

      return { ok: true };
    });

  const normalizeText = (value: string): string => value.trim().toLowerCase();
  const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

  actions
    .operation(
      'mutation',
      'parallel_coords.set_hover',
      'Set the hovered line by row id or car-name match and show its tooltip.',
    )
    .affects(hoverRef)
    .params(
      z.object({
        clear: z.boolean().describe('If true, clear the current hover.').optional(),
        id: z.number().describe('Row id (internal numeric id used by this demo).').optional(),
        car: z.string().describe('Car-name substring to match within the current selection.').optional(),
        prefer: z
          .enum(['first', 'min_horsepower_nonzero', 'max_horsepower'])
          .describe('When multiple matches exist, how to pick a single row.')
          .optional(),
      }),
    )
    .handle((params) => {
      const rec = params ?? {};

      if (rec.clear === true) {
        args.setHoveredId(null, 'agent');

        return { ok: true, hoveredId: null };
      }

      const id = isFiniteNumber(rec.id) ? Math.floor(rec.id) : null;
      const car = typeof rec.car === 'string' && rec.car.trim() ? rec.car.trim() : null;
      const prefer = typeof rec.prefer === 'string' ? rec.prefer : 'first';

      const selected = new Set(args.getSelectedIds());
      const candidates = args.data.filter((d) => selected.has(d.id));

      const pickById = (targetId: number) => {
        const found = candidates.find((d) => d.id === targetId) ?? null;

        if (!found) throw new Error(`No selected row with id=${targetId}`);
        args.setHoveredId(found.id, 'agent');

        return { ok: true, hoveredId: found.id, car: found.Car };
      };

      if (id !== null) return pickById(id);

      if (!car) throw new Error('Expected params.id or params.car (or params.clear=true)');

      const needle = normalizeText(car);
      const matches = candidates.filter((d) => normalizeText(String(d.Car ?? '')).includes(needle));

      if (!matches.length) throw new Error(`No selected row matches car="${car}"`);

      const hp = (d: CarDatum): number => {
        const raw = d.Horsepower;
        const n = typeof raw === 'number' ? raw : Number(raw);

        return Number.isFinite(n) ? n : 0;
      };

      let chosen = matches[0]!;

      if (prefer === 'min_horsepower_nonzero') {
        const nonzero = matches.filter((d) => hp(d) > 0);
        const pool = nonzero.length ? nonzero : matches;
        chosen = pool.reduce((a, b) => (hp(b) < hp(a) ? b : a));
      } else if (prefer === 'max_horsepower') {
        chosen = matches.reduce((a, b) => (hp(b) > hp(a) ? b : a));
      }

      args.setHoveredId(chosen.id, 'agent');

      return { ok: true, hoveredId: chosen.id, car: chosen.Car };
    });

  actions
    .operation('mutation', 'parallel_coords.clear_hover', 'Clear the currently hovered line (hides tooltip).')
    .affects(hoverRef)
    .params(z.object({}).default({}))
    .handle(() => {
      args.setHoveredId(null, 'agent');

      return { ok: true, hoveredId: null };
    });

  actions.standard.applyState(
    (state) => {
      const mutations: Array<() => unknown | Promise<unknown>> = [];
      let applied = 0;

      const order = state[orderRef];

      if (order) {
        const rec = order && typeof order === 'object' ? (order as Record<string, unknown>) : {};
        const v = rec.value ?? rec.order ?? order;

        if (Array.isArray(v)) {
          mutations.push(() => args.setDimensionOrder(v.map(String), 'agent'));
          applied += 1;
        }
      }

      const sel = state[brushRef];

      if (sel) {
        const rec = sel && typeof sel === 'object' ? (sel as Record<string, unknown>) : {};
        const v = rec.ranges ?? rec.brushRanges ?? rec.value ?? sel;

        if (v === null) {
          mutations.push(() => args.resetBrushes('agent'));
          applied += 1;
        } else if (v && typeof v === 'object') {
          const patch: Partial<Record<string, BrushRange | null>> = {};

          for (const [dim, raw] of Object.entries(v as Record<string, unknown>)) {
            if (!args.dimensions.includes(dim)) continue;
            patch[dim] = parseRange(raw);
          }

          mutations.push(() => args.setBrushRanges(patch, 'agent'));
          applied += 1;
        }
      }

      const hover = state[hoverRef];

      if (hover) {
        const rec = hover && typeof hover === 'object' ? (hover as Record<string, unknown>) : {};
        const v = rec.hoveredId ?? rec.id ?? rec.value ?? hover;

        if (v === null) {
          mutations.push(() => args.setHoveredId(null, 'agent'));
          applied += 1;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          mutations.push(() => args.setHoveredId(Math.floor(v), 'agent'));
          applied += 1;
        }
      }

      return async ({ signal }) => {
        for (const mutate of mutations) {
          signal?.throwIfAborted();
          await mutate();
        }
        return { applied };
      };
    },
    { affects: [vizRef], description: 'Apply brush ranges, axis order, and hover state.' },
  );

  const sql = createDuckDbSqlRouter({ duckdb });
  sql.addHandle({
    handleRef,
    getAllSql: () => `SELECT * FROM ${tableName}`,
    getSelectedSql: () => {
      const st = args.getState();
      const preds: string[] = [];

      for (const dim of st.dimensions) {
        const range = st.brushRanges[dim];
        const full = extents[dim];

        if (!range || !full) continue;

        if (nearlyEqual(range[0], full[0]) && nearlyEqual(range[1], full[1])) continue;
        preds.push(`(${sqlIdentifier(dim)} >= ${range[0]} AND ${sqlIdentifier(dim)} <= ${range[1]})`);
      }

      const where = preds.length ? preds.join(' AND ') : null;

      return where ? `SELECT * FROM ${tableName} WHERE ${where}` : `SELECT * FROM ${tableName}`;
    },
  });
  actions.standard.dataSql(sql.handler, {
    enabled: exampleOptions.enableSql,
    inputRefs: [handleRef],
    description: 'Query the current selection via DuckDB SQL. `vacp_handle` is brush-filtered (or all rows if empty).',
  });

  actions.standard.dataSchema(
    async (params) => {
      if (params.handleRef !== handleRef) throw new Error(`Unknown DataHandle: ${params.handleRef}`);
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
      description: 'Return schema/metadata for the cars DataHandle (columns, types, row count, optional summaries).',
    },
  );

  const graph: VacpGraphFragment = {
    actions: actions.registry.list(),
    version: VACP_SCHEMA_VERSION,
    nodes: [
      { ref: viewRef, kind: 'View', layer: 'ViewLayer', title: args.title },
      { ref: vizRef, kind: 'Visualization', layer: 'VisualizationLayer', title: 'Parallel coordinates (SVG)' },
      {
        ref: brushRef,
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'Brush ranges',
        description: 'Per-axis brush ranges in data units.',
        data: { type: 'intervals', dimensions: args.dimensions },
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
        description: 'Query `vacp_all` and `vacp_handle` via `vacp.data_sql`.',
        data: { tableName },
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
    project: () => {
      const st = args.getState();

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
          hoveredCar: st.hoveredId === null ? null : (args.data.find((d) => d.id === st.hoveredId)?.Car ?? null),
        },
        [handleRef]: {
          kind: 'DataHandle',
          tableName,
          selectedCount: st.selectedCount,
          selectedMeaning:
            st.selectedCount === st.totalCount ? 'all rows (no active brush)' : 'rows matching brush ranges',
          duckdb: tableMeta ?? undefined,
        },
      } satisfies Record<VacpRef, unknown>;
      return { graph, state };
    },
  });
  const vacp = installVacp({
    globalKey: args.globalKey,
    exposeBridge: exampleOptions.exposeBridge,
    injectDomSnapshot: exampleOptions.injectDomSnapshot,
    providers: [provider],
  });

  const presence = createExamplePresence(vacp.bridge, args.root);
  presence.attach(provider, {
    resolve: (focus) => {
      if (focus.ref !== brushRef) return null;
      const parsed = z
        .object({ ranges: z.record(z.string(), z.tuple([z.number(), z.number()]).nullable()) })
        .safeParse(focus.detail);
      const first = parsed.success ? Object.entries(parsed.data.ranges).find(([, range]) => range !== null) : undefined;
      if (first?.[1]) {
        const bounds = args.getBrushBounds(first[0], first[1]);
        if (bounds)
          return svgPresenceTarget(bounds.element, {
            kind: 'region',
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
      }
      return elementPresenceTarget(args.root);
    },
    subscribe: (invalidate) => observePresenceLayout(args.root, invalidate),
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
    dispose: () => {
      presence.dispose();
      vacp.dispose();
    },
    refs: { viewRef, vizRef, brushRef, orderRef, hoverRef, handleRef },
  };
}
