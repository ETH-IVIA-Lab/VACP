import type { VacpRef } from '@ethivia/vacp-protocol';

import { makePlotRef, makeViewRef } from './refs';
import type { VgplotMarkLike, VgplotProviderOptions, VgplotPlotLike, VgplotTableLike } from './types';

export type VgplotDataHandle = {
  ref: VacpRef;
  surfaceKind: 'plot' | 'table';
  surfaceId: string;
  /** The DuckDB table the handle's SQL reads. */
  table: string;
};

/** The DuckDB table a mark reads, or null for a mark drawing literal values. */
export function markTable(mark: VgplotMarkLike): string | null {
  try {
    const table = mark.sourceTable?.();
    return typeof table === 'string' && table ? table : null;
  } catch {
    return null;
  }
}

function discoverPlotTables(plot: VgplotPlotLike): string[] {
  return Array.from(new Set(plot.marks.flatMap((mark) => markTable(mark) ?? []))).sort();
}

function djb2Hash(text: string): string {
  let h = 5381;

  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);

  // Convert to unsigned 32-bit hex.
  return (h >>> 0).toString(16);
}

function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  return s || 'table';
}

export function collectVgplotDataHandles(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
  options: VgplotProviderOptions;
  preferredTables?: string[];
}): VgplotDataHandle[] {
  const out: VgplotDataHandle[] = [];

  const preferred = args.preferredTables ?? [];
  const plotTables = new Map<string, string[]>();
  const allPlotTables: string[] = [];

  for (const { plotId, plot } of args.plots) {
    const unique = discoverPlotTables(plot);
    plotTables.set(plotId, unique);
    allPlotTables.push(...unique);
  }

  const uniquePlotTables = Array.from(new Set(allPlotTables)).sort();
  const viewMainTable = uniquePlotTables.find((t) => preferred.includes(t)) ?? uniquePlotTables[0];

  const viewMainRef =
    viewMainTable !== undefined
      ? makeViewRef({ appId: args.options.appId, viewId: args.options.viewId, suffix: '/data/main' })
      : null;

  const viewTableRef = (table: string): VacpRef => {
    if (table === viewMainTable && viewMainRef) return viewMainRef;
    const slug = `${slugify(table)}-${djb2Hash(table).slice(0, 8)}`;

    return makeViewRef({ appId: args.options.appId, viewId: args.options.viewId, suffix: `/data/${slug}` });
  };

  for (const { plotId } of args.plots) {
    const unique = plotTables.get(plotId) ?? [];
    const plotMainTable = unique.find((t) => preferred.includes(t)) ?? unique[0];

    // A plot whose marks read no DuckDB table, such as one drawing literal values, offers no handle.
    if (!plotMainTable) continue;

    const tablesForPlot = [plotMainTable, ...unique.filter((t) => t !== plotMainTable)];

    for (const table of tablesForPlot) {
      out.push({ ref: viewTableRef(table), surfaceKind: 'plot', surfaceId: plotId, table });
    }
  }

  for (const { tableId, table } of args.tables ?? []) {
    const tableName = typeof table.from === 'string' && table.from ? table.from : undefined;
    if (!tableName) continue;

    const ref = makePlotRef({
      appId: args.options.appId,
      viewId: args.options.viewId,
      plotId: tableId,
      suffix: '/data/main',
    });

    out.push({ ref, surfaceKind: 'table', surfaceId: tableId, table: tableName });
  }

  return out;
}
