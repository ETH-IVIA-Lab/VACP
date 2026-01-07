import type { VacpRef } from '@vacp/core';

import { makePlotRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions, VgplotPlotLike } from './types';

export type MosaicDataHandle = { ref: VacpRef; plotId: string; table?: string };

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
  const s = text.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
  return s || 'table';
}

export function collectMosaicDataHandles(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  options: InstallVacpOnVgplotDashboardOptions;
  preferredTables?: string[];
}): MosaicDataHandle[] {
  const out: MosaicDataHandle[] = [];
  for (const { plotId, plot } of args.plots) {
    const unique = discoverPlotTables(plot);
    const preferred = args.preferredTables ?? [];
    const mainTable = unique.find((t) => preferred.includes(t)) ?? unique[0];
    const mainRef = makePlotRef({
      appId: args.options.appId,
      viewId: args.options.viewId,
      plotId,
      suffix: '/data/main',
    });
    out.push({ ref: mainRef, plotId, table: mainTable });

    unique.slice(1).forEach((table) => {
      const slug = `${slugify(table)}-${djb2Hash(table).slice(0, 8)}`;
      const ref = makePlotRef({
        appId: args.options.appId,
        viewId: args.options.viewId,
        plotId,
        suffix: `/data/${slug}`,
      });
      out.push({ ref, plotId, table });
    });
  }
  return out;
}
