import { installVacpRuntime } from '@vacp/runtime-browser';
import { exampleOptions } from '../../config';
/**
 * VACP integration layer.
 *
 * VGPlot renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { createVgplotProvider, type VgplotPlotLike, type VgplotTableLike } from '@vacp/adapter-vgplot';
import type { VacpDuckDbClient } from '@vacp/data-duckdb';

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
    },
  });

  const { runtime: bridge } = installVacpRuntime({
    providers: [provider],
    globalKey: args.globalKey,
    sessionKey: viewId,
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
        getBaseProperties: () => ({ vacp_app_id: appId, vacp_view_id: viewId }),
        captureSnapshots,
      },
    });
  }
}

export async function waitForActionInteractors(args: {
  entryId: string;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  timeoutMs?: number;
  isStale?: () => boolean;
}): Promise<boolean> {
  const requirements = actionInteractorRequirements(args.entryId);

  if (!requirements.length) return true;

  const timeoutMs = args.timeoutMs ?? 10_000;
  const start = performance.now();

  while (performance.now() - start <= timeoutMs) {
    if (args.isStale?.()) return false;

    if (meetsInteractorRequirements(args.plots, requirements)) return true;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  if (args.isStale?.()) return false;

  const expected = requirements.map((req) => `${req.minCount} ${req.name}`).join(', ');
  throw new Error(`Timed out waiting for VGPlot interactors: ${expected}`);
}

function actionInteractorRequirements(entryId: string): Array<{ name: string; minCount: number }> {
  switch (entryId) {
    case 'athletes':
      return [{ name: 'Interval2D', minCount: 1 }];
    case 'crossfilter':
      return [{ name: 'Interval1D', minCount: 2 }];
    case 'flights-hexbin':
      return [{ name: 'Interval1D', minCount: 2 }];
    case 'line-multi-series':
      return [{ name: 'Nearest', minCount: 1 }];
    case 'normalize':
      return [{ name: 'Nearest', minCount: 1 }];
    case 'nyc-taxi-rides':
      return [
        { name: 'Interval2D', minCount: 2 },
        { name: 'Interval1D', minCount: 1 },
      ];
    case 'pan-zoom':
      return [{ name: 'PanZoom', minCount: 1 }];
    case 'weather':
      return [{ name: 'Interval1D', minCount: 1 }];
    default:
      return [];
  }
}

function meetsInteractorRequirements(
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>,
  requirements: Array<{ name: string; minCount: number }>,
): boolean {
  const counts = new Map<string, number>();

  for (const req of requirements) counts.set(req.name, 0);

  for (const { plot } of plots) {
    for (const interactor of plot.interactors ?? []) {
      const name = interactor.constructor?.name ?? '';

      if (!counts.has(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return requirements.every((req) => (counts.get(req.name) ?? 0) >= req.minCount);
}
