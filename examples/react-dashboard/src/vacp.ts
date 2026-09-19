import { createVacpActions, createVacpProvider, installVacp } from '@vacp/sdk';
import { installVacpWebMcp } from '@vacp/transport-webmcp';
import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { exampleOptions } from '../../config';
import { registerDashboardActions } from './vacp/actions';
import { createDashboardData } from './vacp/data';
import { projectDashboard } from './vacp/projection';
import { dashboardRefs, dashboardIdentity } from './vacp/refs';
import type { ReactDashboardModel } from './vacp/model';

/** Compose host ports, analytical projection, and optional browser transports. */
export function installVacpForReactDashboard(args: { globalKey?: string; title?: string; model: ReactDashboardModel }) {
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

  return { ...vacp, refs: dashboardRefs };
}
