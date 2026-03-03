/**
 * VACP integration layer.
 *
 * VGPlot renders the visualization. This module adds a VACP bridge and semantic
 * actions on top, without changing how the visualization is authored.
 */

import { installVacpPosthogAnalytics } from '@vacp/analytics';
import { installVacpOnVgplotDashboard, type VgplotPlotLike, type VgplotTableLike } from '@vacp/vgplot';
import type { VacpDuckDbClient } from '@vacp/duckdb';
import { buildVgplotPlaybooks } from './playbooks';

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

  // Some playbooks depend on vgplot interactors being present. When switching specs, vgplot can attach
  // interactors a tick after the SVG renders, so we wait briefly for the expected interactor types to
  // appear before building playbooks (avoids "No playbooks" flake).
  await waitForPlaybookInteractors(args.entry.id, args.plots);

  const bridge = installVacpOnVgplotDashboard({
    root: args.root,
    plots: args.plots,
    tables: args.tables,
    options: {
      appId,
      viewId,
      title: args.entry.meta.title,
      globalKey: args.globalKey,
      playbooks: buildVgplotPlaybooks({
        entry: { id: args.entry.id, meta: args.entry.meta, spec: args.entry.spec },
        root: args.root,
        plots: args.plots,
        tables: args.tables,
      }),
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

async function waitForPlaybookInteractors(
  entryId: string,
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>,
  timeoutMs = 5_000,
): Promise<void> {
  const requirements = playbookInteractorRequirements(entryId);
  if (!requirements.length) return;

  const start = performance.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (meetsInteractorRequirements(plots, requirements)) return;
    if (performance.now() - start > timeoutMs) return;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

function playbookInteractorRequirements(entryId: string): Array<{ name: string; minCount: number }> {
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
  void plots;
  const counts = new Map<string, number>();
  for (const req of requirements) counts.set(req.name, 0);

  for (const { plot } of plots) {
    for (const it of plot.interactors ?? []) {
      const name = it.constructor?.name ?? '';
      if (!counts.has(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  for (const req of requirements) {
    const n = counts.get(req.name) ?? 0;
    if (n < req.minCount) return false;
  }
  return true;
}
