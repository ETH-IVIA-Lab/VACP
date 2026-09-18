import { installVacpRuntime } from '@vacp/runtime-browser';
import { exampleOptions } from '../../config';
/**
 * VACP integration layer.
 *
 * Vega-Lite renders the chart. This module adds a VACP bridge that exposes
 * Vega parameters/selections as semantic nodes/actions.
 */

import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { createVegaLiteProvider, type VegaViewLike } from '@vacp/adapter-vega-lite';
import type { VisualizationSpec } from 'vega-embed';
import { createDuckDbWasmClient } from '@vacp/data-duckdb';

const duckdbClient = createDuckDbWasmClient();

import type { GalleryEntry } from './gallery';

export async function installVacp(args: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VisualizationSpec;
  entry: GalleryEntry;
  globalKey?: string;
}): Promise<void> {
  const appId = 'vacp-examples';
  const viewId = `vega-lite/${args.entry.id}`;

  const provider = createVegaLiteProvider({
    root: args.root,
    view: args.view,
    spec: args.spec,
    options: {
      enableSql: exampleOptions.enableSql,
      duckdbClient: await duckdbClient,
      appId,
      viewId,
      vizId: args.entry.id,
      title: args.entry.meta.title,
      includeSetSignalAction: false,
    },
  });

  const { runtime: bridge } = installVacpRuntime({
    providers: [provider],
    globalKey: args.globalKey,
    sessionKey: viewId,
    runtimeId: exampleOptions.runtimeId,
    exposeBridge: exampleOptions.exposeBridge,
    injectDomSnapshot: exampleOptions.injectDomSnapshot,
  });

  // Optional analytics: if PostHog is configured, stream VACP history into the session replay.
  const posthogApiKey = import.meta.env.VACP_POSTHOG_API_KEY as string | undefined;

  if (posthogApiKey) {
    const posthogDefaults = import.meta.env.VACP_POSTHOG_DEFAULTS as string | undefined;
    const captureSnapshots = (import.meta.env.VACP_POSTHOG_CAPTURE_SNAPSHOTS as string | undefined) === '1';
    installVacpPosthogAnalytics({
      bridge,
      posthog: {
        apiKey: posthogApiKey,
        apiHost: import.meta.env.VACP_POSTHOG_API_HOST as string | undefined,
        config: posthogDefaults
          ? { defaults: posthogDefaults as NonNullable<VacpPosthogOptions['config']>['defaults'] }
          : undefined,
      },
      analytics: {
        getBaseProperties: () => ({ vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: args.entry.id }),
        captureSnapshots,
      },
    });
  }
}
