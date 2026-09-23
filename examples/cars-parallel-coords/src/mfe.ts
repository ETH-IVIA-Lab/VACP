import './styles.css';

import { run } from './app';

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

export async function mount(target: HTMLElement): Promise<void> {
  target.innerHTML = template;
  await run();
}
