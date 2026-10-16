import './styles.css';
import { createParallelCoordsChart } from './chart';
import { loadCarsDataset } from './data';
import { vacpHumanActor } from '@vacp/protocol';
import { connectVacp } from './vacp';

const template = `
  <section id="container" class="cars-shell">
    <header class="cars-header">
      <h1>Cars, 1970 to 1982</h1>
      <p>392 models across seven measures. Brush an axis to keep the cars in that range, and drag an axis title to reorder the measures.</p>
    </header>
    <div class="controls">
      <button id="reset-brush" type="button">Reset Brush</button>
      <button id="reset-dimensions" type="button">Reset Dimension Order</button>
    </div>
    <div id="chart"></div>
    <div id="tooltip"></div>
  </section>
`;

export async function mount(target: HTMLElement): Promise<() => void> {
  target.innerHTML = template;
  const element = <Found extends HTMLElement>(selector: string) => {
    const found = target.querySelector<Found>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const chartRoot = element<HTMLDivElement>('#chart');
  const tooltip = element<HTMLDivElement>('#tooltip');
  const lifetime = new AbortController();
  const cleanup: Array<() => void> = [];
  const dispose = () => {
    lifetime.abort();
    for (const release of cleanup.splice(0).reverse()) release();
    target.replaceChildren();
  };
  const listen = (source: EventTarget, type: string, listener: () => void) => {
    source.addEventListener(type, listener);
    cleanup.push(() => source.removeEventListener(type, listener));
  };
  try {
    const { data, dimensions } = await loadCarsDataset('data/cars.csv');
    if (!data.length || !dimensions.length) throw new Error('Cars dataset is empty');

    let gesture = (_message: string) => {};
    const chart = createParallelCoordsChart({
      root: chartRoot,
      tooltip,
      data,
      dimensions,
      onGesture: (message) => gesture(message),
    });
    cleanup.push(chart.destroy);
    const runtime = await connectVacp({
      chart,
      root: chartRoot,
      title: 'Cars parallel coordinates',
      data,
      dimensions,
      signal: lifetime.signal,
    });
    gesture = (message) => {
      void runtime.refresh({ actor: vacpHumanActor, message }).catch(() => {});
    };
    listen(element('#reset-brush'), 'click', () => {
      chart.resetBrushes();
      gesture('reset brushes');
    });
    listen(element('#reset-dimensions'), 'click', () => {
      chart.resetDimensionOrder();
      gesture('reset dimension order');
    });
    listen(window, 'resize', () => chart.render());
    void runtime.refresh({ actor: { id: 'system', kind: 'system' }, message: 'init' }).catch(() => {});
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
