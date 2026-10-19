import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { vacpHumanActor, type VacpActor } from '@ethivia/vacp-protocol';

import './index.css';
import App from './App';
import { useDashboardStore } from './state/dashboard-store';
import { connectVacp } from './vacp';

export async function mount(target: HTMLElement): Promise<() => void> {
  target.classList.add('vacp-react-dashboard-host');
  target.innerHTML = '<div id="root" class="vacp-react-dashboard-root"></div>';
  const element = target.querySelector<HTMLElement>('#root');
  if (!element) throw new Error('Missing react dashboard root element');
  const lifetime = new AbortController();
  const cleanup: Array<() => void> = [];
  const dispose = () => {
    lifetime.abort();
    for (const release of cleanup.splice(0).reverse()) release();
    target.replaceChildren();
    target.classList.remove('vacp-react-dashboard-host');
  };
  try {
    const runtime = await connectVacp({
      root: element,
      title: 'Iris and Motor Trend explorer',
      model: {
        read: () => useDashboardStore.getState(),
        subscribe: (invalidate) => useDashboardStore.subscribe(invalidate),
        ...useDashboardStore.getState().actions,
      },
      signal: lifetime.signal,
    });
    const refresh = (actor: VacpActor, message: string) => {
      void runtime.refresh({ actor, message }).catch(() => {});
    };
    const root = createRoot(element);
    cleanup.push(() => root.unmount());
    root.render(
      <StrictMode>
        <App onInteraction={(message) => refresh(vacpHumanActor, message)} />
      </StrictMode>,
    );
    refresh({ id: 'system', kind: 'system' }, 'init');
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
