/**
 * VACP integration layer.
 *
 * Mosaic renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { installVacpOnVgplotDashboard, type VgplotPlotLike } from '@vacp/mosaic';
import type { VacpDuckDbClient } from '@vacp/duckdb';

import { buildPlaybooks } from './playbooks';
import type { GalleryEntry } from './gallery';

export function installVacpLayerForMosaic(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; svg: SVGElement }>;
  entry: GalleryEntry;
  globalKey: string;
  duckdbClient: VacpDuckDbClient;
}): void {
  installVacpOnVgplotDashboard({
    root: args.root,
    plots: args.plots,
    options: {
      appId: 'vacp-examples',
      viewId: `mosaic/${args.entry.id}`,
      title: args.entry.meta.title,
      globalKey: args.globalKey,
      demos: buildPlaybooks(args.entry),
      duckdbClient: args.duckdbClient,
    },
  });
}
