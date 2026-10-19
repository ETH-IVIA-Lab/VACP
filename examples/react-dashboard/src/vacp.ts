import { z } from 'zod';
import { createVacpProvider, type VacpRuntime } from '@ethivia/vacp-runtime';
import { createVacpActions } from '@ethivia/vacp-sdk';
import { installExampleRuntime } from '@ethivia/vacp-example-shared';
import { exampleOptions } from '@ethivia/vacp-example-shared/config';
import { elementPresenceTarget, observePresenceLayout } from '@ethivia/vacp-presence/dom';
import type { PresenceTarget } from '@ethivia/vacp-presence';
import { registerDashboardActions } from './vacp/actions';
import { createDashboardData } from './vacp/data';
import { projectDashboard } from './vacp/projection';
import { dashboardRefs, dashboardIdentity } from './vacp/refs';
import type { ReactDashboardModel } from './vacp/model';

/** Compose host ports, the analytical projection, and presence for the lifetime of `signal`. */
export function connectVacp(args: {
  root: HTMLElement;
  title: string;
  model: ReactDashboardModel;
  signal: AbortSignal;
}): Promise<VacpRuntime> {
  const { root, title, model, signal } = args;
  const { appId, viewId, vizId } = dashboardIdentity;
  const actions = createVacpActions();
  registerDashboardActions(actions, model);
  const data = createDashboardData(actions, model, exampleOptions.enableSql);
  signal.addEventListener('abort', () => data.dispose(), { once: true });
  const provider = createVacpProvider({
    source: {
      id: `vacp-source://${appId}/${viewId}/${vizId}/react-dashboard`,
      type: 'react-dashboard',
      title: 'React analytics dashboard',
    },
    actions: actions.registry,
    subscribe: model.subscribe,
    project: () => {
      const snapshot = model.read();
      return projectDashboard(snapshot, actions.registry.list(), data.describe(snapshot.datasetId), title);
    },
  });

  // React re-renders replace nodes, so every lookup starts from the current DOM.
  const query = (selector: string) => root.querySelector<HTMLElement>(selector);
  const exact = (element: HTMLElement | null): PresenceTarget | null =>
    element ? elementPresenceTarget(element, 'exact') : null;
  const scatter = () => query('[data-dashboard-view="scatter"]');
  const selectedPoints = z.object({ ids: z.array(z.string()) });
  const { handleRef, scatterRef, selectionRef, brush2dRef } = dashboardRefs;
  return installExampleRuntime({
    sources: [
      {
        provider,
        presentation: {
          subscribe: (invalidate) => observePresenceLayout(root, invalidate),
          resolve: (focus, { signal }) => {
            signal.throwIfAborted();
            if (focus.ref === handleRef) return exact(query('[data-dashboard-control="dataset"]'));
            if (focus.ref === scatterRef) return exact(query('[data-dashboard-control="encoding"]') ?? scatter());
            if (focus.ref === brush2dRef) {
              const brush = query('[data-dashboard-view="scatter"] svg rect[rx]');
              return brush ? elementPresenceTarget(brush, 'region') : exact(scatter());
            }
            if (focus.ref === selectionRef) {
              const id = selectedPoints.safeParse(focus.detail).data?.ids[0];
              const point = id
                ? query(`[data-dashboard-view="scatter"] circle[data-point-id="${CSS.escape(id)}"]`)
                : null;
              return point ? elementPresenceTarget(point, 'exact') : exact(scatter());
            }
            return null;
          },
        },
      },
    ],
    root,
    sessionKey: viewId,
    analytics: { vacp_app_id: appId, vacp_view_id: viewId, vacp_viz_id: vizId },
    signal,
  });
}
