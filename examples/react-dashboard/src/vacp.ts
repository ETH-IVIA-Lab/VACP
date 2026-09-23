import { createVacpActions, createVacpProvider, installVacp } from '@vacp/sdk';
import { createExamplePresence } from '@vacp/example-shared';
import { elementPresenceTarget, observePresenceLayout } from '@vacp/presence-browser';
import type { PresenceTarget } from '@vacp/presence-core';
import { installVacpWebMcp } from '@vacp/transport-webmcp';
import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { exampleOptions } from '../../config';
import { registerDashboardActions } from './vacp/actions';
import { createDashboardData } from './vacp/data';
import { projectDashboard } from './vacp/projection';
import { dashboardRefs, dashboardIdentity } from './vacp/refs';
import type { ReactDashboardModel } from './vacp/model';

/** Compose host ports, analytical projection, presence, and optional browser transports. */
export function installVacpForReactDashboard(args: {
  root: HTMLElement;
  globalKey?: string;
  title?: string;
  model: ReactDashboardModel;
}) {
  const { appId, viewId, vizId } = dashboardIdentity;
  const title = args.title ?? 'React dashboard';
  const actions = createVacpActions();
  registerDashboardActions(actions, args.model);
  const data = createDashboardData(actions, args.model, exampleOptions.enableSql);
  const provider = createVacpProvider({
    source: {
      id: `vacp-source://${appId}/${viewId}/${vizId}/react-dashboard`,
      type: 'react-dashboard',
      title: 'React analytics dashboard',
    },
    actions: actions.registry,
    subscribe: args.model.subscribe,
    project: () => {
      const snapshot = args.model.read();
      return projectDashboard(snapshot, actions.registry.list(), data.describe(snapshot.datasetId), title);
    },
    dispose: () => data.dispose(),
  });
  const vacp = installVacp({
    globalKey: args.globalKey,
    exposeBridge: exampleOptions.exposeBridge,
    injectDomSnapshot: exampleOptions.injectDomSnapshot,
    providers: [provider],
  });

  // React re-renders replace nodes, so every lookup starts from the current DOM.
  const presence = createExamplePresence(vacp.bridge, args.root);
  const { root } = args;
  const query = (selector: string) => root.querySelector<HTMLElement>(selector);
  const exact = (element: HTMLElement | null): PresenceTarget | null =>
    element ? elementPresenceTarget(element, 'exact') : null;
  const scatter = () => query('[data-dashboard-view="scatter"]');
  presence.attach(provider, {
    subscribe: (invalidate) => observePresenceLayout(root, invalidate),
    resolve: (focus, { signal }) => {
      signal.throwIfAborted();
      const { handleRef, scatterRef, selectionRef, brush2dRef } = dashboardRefs;
      if (focus.ref === handleRef) return exact(query('[data-dashboard-control="dataset"]'));
      if (focus.ref === scatterRef) return exact(query('[data-dashboard-control="encoding"]') ?? scatter());
      if (focus.ref === brush2dRef) {
        const brush = query('[data-dashboard-view="scatter"] svg rect[rx]');
        return brush ? elementPresenceTarget(brush, 'region') : exact(scatter());
      }
      if (focus.ref === selectionRef) {
        const ids = (focus.detail as { ids?: string[] } | undefined)?.ids ?? [];
        const point = ids.length
          ? query(`[data-dashboard-view="scatter"] circle[data-point-id="${CSS.escape(ids[0]!)}"]`)
          : null;
        return point ? elementPresenceTarget(point, 'exact') : exact(scatter());
      }
      return null;
    },
  });

  if (exampleOptions.webmcp) {
    void installVacpWebMcp(vacp.bridge, {
      onError: (cause) => console.error('WebMCP registration failed', cause),
    }).catch((cause) => console.error('WebMCP installation failed', cause));
  }

  // Optional analytics: if PostHog is configured, stream VACP history into the session replay.
  const posthogApiKey = import.meta.env.VACP_POSTHOG_API_KEY as string | undefined;

  if (posthogApiKey) {
    const posthogDefaults = import.meta.env.VACP_POSTHOG_DEFAULTS as string | undefined;
    const captureSnapshots = (import.meta.env.VACP_POSTHOG_CAPTURE_SNAPSHOTS as string | undefined) === '1';
    installVacpPosthogAnalytics({
      bridge: vacp.bridge,
      posthog: {
        apiKey: posthogApiKey,
        apiHost: import.meta.env.VACP_POSTHOG_API_HOST as string | undefined,
        config: posthogDefaults
          ? { defaults: posthogDefaults as NonNullable<VacpPosthogOptions['config']>['defaults'] }
          : undefined,
      },
      analytics: {
        getBaseProperties: () => ({ vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: vizId }),
        captureSnapshots,
      },
    });
  }

  return {
    ...vacp,
    dispose: () => {
      presence.dispose();
      vacp.dispose();
    },
    refs: dashboardRefs,
  };
}
