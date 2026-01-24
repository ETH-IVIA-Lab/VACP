import type { VacpGraphBase } from '@vacp/kit';
import {
  createDuckDbSqlRouter,
  createVacpActions,
  createVacpRefBuilder,
  installVacp,
  makeVacpDuckDbTableName,
  sqlIdentifier,
} from '@vacp/kit';
import { createDuckDbWasmClient, getDuckDbTableMetadata, type VacpDuckDbTableMetadata } from '@vacp/duckdb';
import { VACP_SCHEMA_VERSION, type VacpRef } from '@vacp/core';
import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

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
    const db = await createDuckDbWasmClient({ log: false });
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

  const parseRange = (value: unknown): BrushRange | null => {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length !== 2) return null;
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a <= b ? [a, b] : [b, a];
  };

  actions
    .action(
      'parallel_coords.set_brush_ranges',
      'Set one or more per-axis brush ranges (data units). Use null to clear.',
    )
    .target(brushRef)
    .params({
      type: 'object',
      properties: {
        ranges: {
          type: 'object',
          additionalProperties: {
            anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }],
          },
        },
      },
      required: ['ranges'],
    })
    .handle((params) => {
      const rec = (params ?? {}) as { ranges?: unknown };
      const rangesRaw = rec.ranges;
      if (!rangesRaw || typeof rangesRaw !== 'object') throw new Error('Expected params.ranges object');

      const patch: Partial<Record<string, BrushRange | null>> = {};
      for (const [dim, raw] of Object.entries(rangesRaw as Record<string, unknown>)) {
        if (!args.dimensions.includes(dim)) throw new Error(`Unknown dimension: ${dim}`);
        const range = parseRange(raw);
        if (raw !== null && !range) throw new Error(`Invalid range for "${dim}": expected [min,max]`);
        patch[dim] = range;
      }

      args.setBrushRanges(patch, 'agent');
      return { selectedCount: args.getState().selectedCount };
    });

  actions
    .action('parallel_coords.reset_brushes', 'Reset all brushes to the full data extents.')
    .target(brushRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.resetBrushes('agent');
      return { ok: true, selectedCount: args.getState().selectedCount };
    });

  actions
    .action('parallel_coords.set_dimension_order', 'Set the axis order as an array of dimension names.')
    .target(orderRef)
    .params({
      type: 'object',
      properties: { order: { type: 'array', items: { type: 'string' } } },
      required: ['order'],
    })
    .handle((params) => {
      const rec = (params ?? {}) as { order?: unknown };
      if (!Array.isArray(rec.order)) throw new Error('Expected params.order array');
      const order = rec.order.map(String);
      args.setDimensionOrder(order, 'agent');
      return { ok: true };
    });

  actions
    .action('parallel_coords.reset_dimension_order', 'Reset axis order back to the dataset default.')
    .target(orderRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.resetDimensionOrder('agent');
      return { ok: true };
    });

  const normalizeText = (value: string): string => value.trim().toLowerCase();
  const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

  actions
    .action('parallel_coords.set_hover', 'Set the currently hovered line (shows tooltip; best-effort).')
    .target(hoverRef)
    .params({
      type: 'object',
      properties: {
        clear: { type: 'boolean', description: 'If true, clear the current hover.' },
        id: { type: 'number', description: 'Row id (internal numeric id used by this demo).' },
        car: { type: 'string', description: 'Car name to hover (best-effort match within current selection).' },
        prefer: {
          type: 'string',
          enum: ['first', 'min_horsepower_nonzero', 'max_horsepower'],
          description: 'When multiple matches exist, how to pick a single row.',
        },
      },
    })
    .handle((params) => {
      const rec = (params ?? {}) as { clear?: unknown; id?: unknown; car?: unknown; prefer?: unknown };
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
    .action('parallel_coords.clear_hover', 'Clear the currently hovered line (hides tooltip).')
    .target(hoverRef)
    .params({ type: 'object', properties: {} })
    .handle(() => {
      args.setHoveredId(null, 'agent');
      return { ok: true, hoveredId: null };
    });

  actions.standard.applyState(
    (state) => {
      let applied = 0;

      const order = state[orderRef as unknown as string];
      if (order) {
        const rec = order && typeof order === 'object' ? (order as Record<string, unknown>) : {};
        const v = (rec.value ?? rec.order ?? order) as unknown;
        if (Array.isArray(v)) {
          args.setDimensionOrder(v.map(String), 'agent');
          applied += 1;
        }
      }

      const sel = state[brushRef as unknown as string];
      if (sel) {
        const rec = sel && typeof sel === 'object' ? (sel as Record<string, unknown>) : {};
        const v = (rec.ranges ?? rec.brushRanges ?? rec.value ?? sel) as unknown;
        if (v === null) {
          args.resetBrushes('agent');
          applied += 1;
        } else if (v && typeof v === 'object') {
          const patch: Partial<Record<string, BrushRange | null>> = {};
          for (const [dim, raw] of Object.entries(v as Record<string, unknown>)) {
            if (!args.dimensions.includes(dim)) continue;
            patch[dim] = parseRange(raw);
          }
          args.setBrushRanges(patch, 'agent');
          applied += 1;
        }
      }

      const hover = state[hoverRef as unknown as string];
      if (hover) {
        const rec = hover && typeof hover === 'object' ? (hover as Record<string, unknown>) : {};
        const v = (rec.hoveredId ?? rec.id ?? rec.value ?? hover) as unknown;
        if (v === null) {
          args.setHoveredId(null, 'agent');
          applied += 1;
        } else if (typeof v === 'number' && Number.isFinite(v)) {
          args.setHoveredId(Math.floor(v), 'agent');
          applied += 1;
        }
      }

      return { applied };
    },
    { targetRef: vizRef, description: 'Apply brush ranges + dimension order (best-effort).' },
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
    targetRef: handleRef,
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
      targetRef: handleRef,
      description: 'Return schema/metadata for the cars DataHandle (columns, types, row count, optional summaries).',
    },
  );

  const graph: VacpGraphBase = {
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
        description: 'Axis order (left → right).',
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

  const buildPlaybooks = (): VacpPlaybook[] => {
    const dims = [...args.dimensions];
    const preferOrder = (a: string, b: string): string[] => {
      const out: string[] = [];
      [a, b].forEach((d) => {
        if (dims.includes(d) && !out.includes(d)) out.push(d);
      });
      dims.forEach((d) => {
        if (!out.includes(d)) out.push(d);
      });
      return out;
    };

    return [
      playbook({
        id: 'cars-parcoords-cyl-4-weight-range',
        title: 'Playbook: Cars (4 cylinders → weight range)',
        description: 'Brush Cylinders = 4 and inspect the Weight axis range for the selected subset.',
      })
        .action('Reset brushes (clean slate)', { name: 'parallel_coords.reset_brushes', params: {} })
        .action('Brush: Cylinders = 4', {
          name: 'parallel_coords.set_brush_ranges',
          params: { ranges: { Cylinders: [4, 4] } },
        })
        .build(),

      playbook({
        id: 'cars-parcoords-dim-correlation-displacement-weight',
        title: 'Playbook: Cars (largest positive correlation)',
        description:
          'Reorder axes to place the strongest positively correlated dimensions adjacent (excluding discrete Cylinders).',
      })
        .action('Reset dimension order (clean slate)', { name: 'parallel_coords.reset_dimension_order', params: {} })
        .action('Place Displacement next to Weight', {
          name: 'parallel_coords.set_dimension_order',
          params: { order: preferOrder('Displacement', 'Weight') },
        })
        .build(),

      playbook({
        id: 'cars-parcoords-6cyl-horsepower-outliers',
        title: 'Playbook: Cars (6 cylinders → horsepower outliers)',
        description:
          'Brush Cylinders = 6 and inspect horsepower outliers; use hover (tooltip) to identify the outlier cars.',
      })
        .action('Reset brushes (clean slate)', { name: 'parallel_coords.reset_brushes', params: {} })
        .action('Clear hover (clean slate)', { name: 'parallel_coords.clear_hover', params: {} })
        .action('Brush: Cylinders = 6', {
          name: 'parallel_coords.set_brush_ranges',
          params: { ranges: { Cylinders: [6, 6] } },
        })
        .action('Hover: Ford Grenada ghia', {
          name: 'parallel_coords.set_hover',
          params: { car: 'Ford Grenada ghia', prefer: 'first' },
        })
        .action('Hover: Ford Maverick (lowest non-zero horsepower match)', {
          name: 'parallel_coords.set_hover',
          params: { car: 'Ford Maverick', prefer: 'min_horsepower_nonzero' },
        })
        .build(),
    ];
  };

  const vacp = installVacp({
    globalKey: args.globalKey,
    graph,
    actions: actions.registry,
    getState: () => {
      const st = args.getState();
      return {
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
          duckdb: (tableMeta ?? undefined) as VacpDuckDbTableMetadata | undefined,
        },
      } satisfies Record<VacpRef, unknown>;
    },
    playbooks: buildPlaybooks(),
  });

  return { ...vacp, refs: { viewRef, vizRef, brushRef, orderRef, hoverRef, handleRef } };
}
