/**
 * VACP integration layer.
 *
 * Mosaic renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { installVacpOnVgplotDashboard, type VgplotPlotLike } from '@vacp/mosaic';
import type { VacpDuckDbClient } from '@vacp/duckdb';
import { buildMosaicPlaybooks } from '@vacp/example-playbooks';

import type { GalleryEntry } from './gallery';

export function installVacpLayerForMosaic(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
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
      demos: buildMosaicPlaybooks({
        entry: { id: args.entry.id, meta: args.entry.meta, spec: args.entry.spec },
        plots: args.plots,
      }),
      duckdbClient: args.duckdbClient,
    },
  });
}
