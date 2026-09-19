import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import './index.css';
import App from './App';
import { useDashboardStore } from './state/dashboard-store';
import { installVacpForReactDashboard } from './vacp';

export function mountReactDashboard(rootEl: HTMLElement): () => void {
  void useDashboardStore.getState().actions.init();

  const vacp = installVacpForReactDashboard({
    title: 'React dashboard',
    model: {
      read: () => useDashboardStore.getState(),
      subscribe: (invalidate) => useDashboardStore.subscribe(invalidate),
      ...useDashboardStore.getState().actions,
    },
  });

  const root: Root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <App onInteraction={(msg) => vacp.refresh('human', msg)} />
    </StrictMode>,
  );

  vacp.refresh('system', 'init');

  return () => {
    root.unmount();
    vacp.dispose();
  };
}
