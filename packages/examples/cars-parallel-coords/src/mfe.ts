import './styles.css';

import { run } from './app';

const template = `
  <section id="container" class="cars-shell">
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

export default { mount };
