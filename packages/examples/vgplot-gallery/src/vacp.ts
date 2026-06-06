/**
 * VACP integration layer.
 *
 * VGPlot renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { installVacpPosthogAnalytics } from '@vacp/analytics';
import { installVacpOnVgplotDashboard, type VgplotPlotLike, type VgplotTableLike } from '@vacp/vgplot';
import type { VacpDuckDbClient } from '@vacp/duckdb';

import type { GalleryEntry } from './gallery';

export async function installVacp(args: {
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike; element: Element; svg?: SVGElement }>;
  tables: Array<{ tableId: string; table: VgplotTableLike; element: Element }>;
  entry: GalleryEntry;
  globalKey?: string;
  duckdbClient: VacpDuckDbClient;
}): Promise<void> {
  const appId = 'vacp-examples';
  const viewId = `vgplot/${args.entry.id}`;

  const bridge = installVacpOnVgplotDashboard({
    root: args.root,
    plots: args.plots,
    tables: args.tables,
    options: {
      appId,
      viewId,
      title: args.entry.meta.title,
      globalKey: args.globalKey,
      duckdbClient: args.duckdbClient,
    },
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
        config: posthogDefaults ? { defaults: posthogDefaults } : undefined,
      },
      analytics: {
        getBaseProperties: () => ({ vacp_app_id: appId, vacp_view_id: viewId }),
        captureSnapshots,
      },
    });
  }
}
