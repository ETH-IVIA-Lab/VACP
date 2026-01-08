/**
 * VACP integration layer.
 *
 * Vega-Lite renders the chart. This module adds a VACP bridge that exposes
 * Vega parameters/selections as semantic nodes/actions.
 */

import { installVacpOnVegaLiteView, type VegaViewLike } from '@vacp/vega-lite';
import type { VisualizationSpec } from 'vega-embed';
import { buildVegaLitePlaybooks } from './playbooks';

import type { GalleryEntry } from './gallery';

export function installVacpLayerForVegaLite(args: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VisualizationSpec;
  entry: GalleryEntry;
  globalKey: string;
}): void {
  installVacpOnVegaLiteView({
    root: args.root,
    view: args.view,
    spec: args.spec,
    options: {
      appId: 'vacp-examples',
      viewId: `vega-lite/${args.entry.id}`,
      vizId: args.entry.id,
      title: args.entry.meta.title,
      globalKey: args.globalKey,
      includeSetSignalAction: false,
      demos: buildVegaLitePlaybooks({ id: args.entry.id }),
    },
  });
}
