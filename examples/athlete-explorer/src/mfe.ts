import './style.css';
import { createCohort, loadAthletes } from './model';
import { createDashboard } from './app';
import { createCharts } from './charts';
import { connectVacp } from './vacp';

export async function mount(target: HTMLElement): Promise<() => Promise<void>> {
  const root = document.createElement('div');
  root.className = 'athlete-explorer';
  root.textContent = 'Loading Olympic athletes…';
  target.append(root);
  const lifetime = new AbortController();
  const cleanup: Array<() => void | Promise<void>> = [];
  const dispose = async () => {
    lifetime.abort();
    for (const release of cleanup.splice(0).reverse()) await release();
    root.remove();
  };
  try {
    const model = createCohort(await loadAthletes());
    const dashboard = createDashboard(root, model);
    cleanup.push(() => dashboard.dispose());
    const onError = (error: unknown) => {
      root.dataset.error = 'true';
      const message = root.querySelector<HTMLElement>('.athlete-error');
      if (message) {
        message.hidden = false;
        message.textContent = `Chart update failed: ${String(error)}`;
      }
    };
    const charts = await createCharts(dashboard.body, dashboard.age, model, onError);
    cleanup.push(charts.dispose);
    await connectVacp({ model, charts, dashboard, root, signal: lifetime.signal });
    return dispose;
  } catch (error) {
    await dispose();
    throw error;
  }
}
