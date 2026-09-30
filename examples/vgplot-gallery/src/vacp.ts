import { installGalleryIntegration } from '@vacp/example-shared';
import { createVgplotPresentation } from '@vacp/adapter-vgplot/presentation';
import { exampleOptions } from '../../config';
/**
 * VACP integration layer.
 *
 * VGPlot renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { createVgplotProvider, type VgplotPlotLike, type VgplotTableLike } from '@vacp/adapter-vgplot';
import { sqlIdentifier, type VacpDuckDbClient } from '@vacp/data-duckdb';

import type { GalleryEntry } from './gallery';

export async function installVacp(args: {
  root: Element;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
  tables: Array<{ tableId: string; table: VgplotTableLike; element: Element }>;
  entry: GalleryEntry;
  globalKey?: string;
  signal: AbortSignal;
  duckdbClient: VacpDuckDbClient;
}): Promise<void> {
  const appId = 'vacp-examples';
  const viewId = `vgplot/${args.entry.id}`;

  args.signal.throwIfAborted();
  // A spec's tables load before its plots render and stay as loaded until the next spec, so each is counted once.
  const counts = new Map<string, Promise<number | undefined>>();
  const count = (table: string) =>
    args.duckdbClient
      .queryJson(`SELECT count(*)::INTEGER AS n FROM ${sqlIdentifier(table)}`)
      .then(({ rows }) => Number(rows[0]?.n))
      .catch(() => undefined);
  const provider = createVgplotProvider({
    root: args.root,
    plots: args.plots,
    tables: args.tables,
    options: {
      enableSql: exampleOptions.enableSql,
      appId,
      viewId,
      title: args.entry.meta.title,
      duckdbClient: args.duckdbClient,
      describeDataHandle: async ({ table }) => {
        if (!counts.has(table)) counts.set(table, count(table));
        const rowCount = await counts.get(table);
        return rowCount === undefined ? undefined : { rowCount };
      },
    },
  });

  await installGalleryIntegration({
    provider,
    root: args.root,
    presentation: createVgplotPresentation({ provider, root: args.root }),
    sessionKey: viewId,
    globalKey: args.globalKey,
    signal: args.signal,
    analyticsProperties: { vacp_app_id: appId, vacp_view_id: viewId },
  });
}
