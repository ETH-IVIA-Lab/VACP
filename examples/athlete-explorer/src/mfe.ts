import './style.css';
import { createCohort, loadAthletes } from './model';
import { createDashboard } from './app';
import { createCharts } from './charts';
import { connectVacp } from './vacp';

export async function mount(target: HTMLElement): Promise<() => Promise<void>> {
  const root = document.createElement('div');
  root.className = 'athlete-explorer';
  target.append(root);
  root.textContent = 'Loading Olympic athletes…';
  let disposeDashboard = () => {};
  let disposeCharts: (() => Promise<void>) | undefined;
  let disposeVacp = () => {};
  const dispose = async () => {
    disposeVacp();
    disposeDashboard();
    await disposeCharts?.();
    root.remove();
  };
  try {
    const model = createCohort(await loadAthletes());
    const dashboard = createDashboard(root, model);
    disposeDashboard = dashboard.dispose;
    const onError = (error: unknown) => {
      root.dataset.error = 'true';
      const message = root.querySelector<HTMLElement>('.athlete-error');
      if (message) {
        message.hidden = false;
        message.textContent = `Chart update failed: ${String(error)}`;
      }
    };
    const charts = await createCharts(dashboard.body, dashboard.age, model, onError);
    disposeCharts = charts.dispose;
    disposeVacp = await connectVacp(model, charts, dashboard);
    return dispose;
  } catch (error) {
    await dispose();
    const message = document.createElement('p');
    message.textContent = `Could not load athlete explorer: ${String(error)}`;
    message.setAttribute('role', 'alert');
    target.append(message);
    throw error;
  }
}
