import './shell.css';
import { run } from './app';

export async function mount(target: HTMLElement): Promise<void> {
  target.innerHTML = `
    <section class="example-shell">
      <div class="example-shell__panel">
        <label class="example-shell__label" for="spec">Example</label>
        <select id="spec" class="example-shell__select"></select>
        <p id="spec-meta" class="example-shell__meta"></p>
        <div id="app" class="example-shell__stage"></div>
      </div>
    </section>
  `;
  await run();
}
