import '../../shell.css';
import { run } from './app';

export async function mount(target: HTMLElement): Promise<void> {
  target.innerHTML = `
    <section class="example-shell">
      <div class="example-shell__panel">
        <header class="example-shell__header">
          <h1 id="spec-title" class="example-shell__title"></h1>
          <label class="example-shell__picker">Other views<select id="spec" class="example-shell__select" aria-label="Visualization"></select></label>
        </header>
        <p id="spec-meta" class="example-shell__meta"></p>
        <div id="app" class="example-shell__stage"></div>
      </div>
    </section>
  `;
  await run();
}
