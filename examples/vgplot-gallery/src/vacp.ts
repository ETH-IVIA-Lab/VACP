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
import { countDuckDbTablesOnce, type VacpDuckDbClient } from '@vacp/data-duckdb';

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
      // A spec's data loads before its plots are built and stays as loaded until the next spec renders.
      describeDataHandle: countDuckDbTablesOnce(args.duckdbClient),
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
