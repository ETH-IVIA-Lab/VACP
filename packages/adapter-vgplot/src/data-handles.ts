import type { VacpRef } from '@vacp/protocol';

import { makePlotRef, makeViewRef } from './refs.js';
import type { VgplotProviderOptions, VgplotPlotLike, VgplotTableLike } from './types.js';

export type VgplotDataHandle = {
  ref: VacpRef;
  surfaceKind: 'plot' | 'table';
  surfaceId: string;
  table?: string;
};

export function discoverPlotTables(plot: VgplotPlotLike): string[] {
  const tables: string[] = [];
  plot.marks.forEach((m) => {
    try {
      const t = m.sourceTable?.();

      if (typeof t === 'string' && t) tables.push(t);
    } catch {
      // ignore
    }
  });

  return Array.from(new Set(tables)).sort();
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

    // If the plot exposes no mark table, fall back to a per-plot DataHandle.
    if (!plotMainTable) {
      const fallbackRef = makePlotRef({
        appId: args.options.appId,
        viewId: args.options.viewId,
        plotId,
        suffix: '/data/main',
      });

      out.push({ ref: fallbackRef, surfaceKind: 'plot', surfaceId: plotId, table: undefined });
      continue;
    }

    const tablesForPlot = [plotMainTable, ...unique.filter((t) => t !== plotMainTable)];

    for (const table of tablesForPlot) {
      out.push({ ref: viewTableRef(table), surfaceKind: 'plot', surfaceId: plotId, table });
    }
  }

  for (const { tableId, table } of args.tables ?? []) {
    const tableName = typeof table.from === 'string' && table.from ? table.from : undefined;

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
