import { mountReactDashboard } from './bootstrap';

export function mount(target: HTMLElement): () => void {
  target.classList.add('vacp-react-dashboard-host');
  target.innerHTML = '<div id="root" class="vacp-react-dashboard-root"></div>';
  const rootEl = target.querySelector<HTMLElement>('#root');
  if (!rootEl) throw new Error('Missing react dashboard root element');
  const unmount = mountReactDashboard(rootEl);
  return () => {
    unmount();
    target.classList.remove('vacp-react-dashboard-host');
  };
}

export default { mount };
