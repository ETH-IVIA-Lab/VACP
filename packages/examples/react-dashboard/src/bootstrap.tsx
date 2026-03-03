import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installVacpDebugUI } from '@vacp/kit';

import './index.css';
import App from './App';
import { useDashboardStore } from '@/state/dashboard-store';
import { installVacpForReactDashboard } from './vacp';

async function ensureDataset(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  const actions = useDashboardStore.getState().actions;
  await actions.init();
  while (true) {
    const { dataset, datasetId, error, loading } = useDashboardStore.getState();
    if (dataset) return;
    if (!datasetId) throw new Error('No dataset selected');
    if (error) throw new Error(error);
    if (!loading && Date.now() - start > timeoutMs) throw new Error('Timed out waiting for dataset to load');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function mountReactDashboard(rootEl: HTMLElement): () => void {
  void installVacpDebugUI();

  void useDashboardStore.getState().actions.init();

  const vacp = installVacpForReactDashboard({
    title: 'React dashboard',
    model: {
      ensureDataset,
      getDatasetId: () => useDashboardStore.getState().datasetId,
      getDataset: () => useDashboardStore.getState().dataset,
      setDatasetId: async (id) => {
        await useDashboardStore.getState().actions.setDatasetId(id);
      },
      getEncoding: () => useDashboardStore.getState().encoding,
      setEncoding: (patch) => useDashboardStore.getState().actions.setEncoding(patch),
      getSelectedIds: () => useDashboardStore.getState().selectedIds,
      setSelectedIds: (ids) => useDashboardStore.getState().actions.setSelectedIds(ids),
      toggleSelectedId: (id) => useDashboardStore.getState().actions.toggleSelectedId(id),
      clearSelection: () => useDashboardStore.getState().actions.clearSelection(),
      getBrush2d: () => useDashboardStore.getState().brush2d,
      setBrush2d: (brush) => useDashboardStore.getState().actions.setBrush2d(brush),
      clearBrush2d: () => useDashboardStore.getState().actions.clearBrush2d(),
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
  };
}
