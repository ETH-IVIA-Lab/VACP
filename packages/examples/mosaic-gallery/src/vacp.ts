/**
 * VACP integration layer.
 *
 * Mosaic renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { installVacpOnVgplotDashboard, type VgplotPlotLike, type VgplotTableLike } from '@vacp/vgplot';
import type { VacpDuckDbClient } from '@vacp/duckdb';
import { buildMosaicPlaybooks } from './playbooks';

import type { GalleryEntry } from './gallery';

export function installVacp(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
  tables: Array<{ tableId: string; table: VgplotTableLike; element: Element }>;
  entry: GalleryEntry;
  globalKey?: string;
  duckdbClient: VacpDuckDbClient;
}): void {
  installVacpOnVgplotDashboard({
    root: args.root,
    plots: args.plots,
    tables: args.tables,
    options: {
      appId: 'vacp-examples',
      viewId: `mosaic/${args.entry.id}`,
      title: args.entry.meta.title,
      globalKey: args.globalKey,
      playbooks: buildMosaicPlaybooks({
        entry: { id: args.entry.id, meta: args.entry.meta, spec: args.entry.spec },
        root: args.root,
        plots: args.plots,
        tables: args.tables,
      }),
      duckdbClient: args.duckdbClient,
    },
  });
}
