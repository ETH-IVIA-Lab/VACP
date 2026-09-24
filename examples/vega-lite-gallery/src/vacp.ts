import { exampleDuckDbBundles, installGalleryIntegration } from '@vacp/example-shared';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { exampleOptions } from '../../config';
/**
 * VACP integration layer.
 *
 * Vega-Lite renders the chart. This module adds a VACP bridge that exposes
 * Vega parameters/selections as semantic nodes/actions.
 */

import { createVegaLiteProvider, type VegaViewLike } from '@vacp/adapter-vega-lite';
import type { VisualizationSpec } from 'vega-embed';
import { createDuckDbWasmClient } from '@vacp/data-duckdb';

const duckdbClient = createDuckDbWasmClient({ bundles: exampleDuckDbBundles });

import type { GalleryEntry } from './gallery';

export async function installVacp(args: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VisualizationSpec;
  entry: GalleryEntry;
  globalKey?: string;
  signal: AbortSignal;
}): Promise<void> {
  const appId = 'vacp-examples';
  const viewId = `vega-lite/${args.entry.id}`;

  const client = await duckdbClient;
  args.signal.throwIfAborted();
  const provider = createVegaLiteProvider({
    root: args.root,
    view: args.view,
    spec: args.spec,
    options: {
      enableSql: exampleOptions.enableSql,
      duckdbClient: client,
      appId,
      viewId,
      vizId: args.entry.id,
      title: args.entry.meta.title,
      includeSetSignalAction: false,
    },
  });

  await installGalleryIntegration({
    provider,
    root: args.root,
    presentation: createVegaLitePresentation({ provider, root: args.root }),
    sessionKey: viewId,
    globalKey: args.globalKey,
    signal: args.signal,
    analyticsProperties: { vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: args.entry.id },
  });
}
