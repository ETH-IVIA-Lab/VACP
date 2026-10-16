import './shell.css';
import { escapeHtml } from './html';

export type SpecGalleryEntry = { id: string; title: string; description?: string };

type Dispose = () => void | Promise<void>;

const template = `
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

function element<Found extends HTMLElement>(root: HTMLElement, selector: string): Found {
  const found = root.querySelector<Found>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

/**
 * Render one spec at a time into a shared shell with a picker that follows the location hash.
 *
 * `render` draws `entry` into `stage` and resolves to the disposer of what it created. Switching
 * specs aborts the current `signal`, waits for its render to settle, and runs its disposer before the
 * next render starts. A render that rejects releases its own partial work. `describe` turns a
 * description into HTML and escapes it as text by default.
 */
export async function mountSpecGallery<Entry extends SpecGalleryEntry>(
  target: HTMLElement,
  options: {
    entries: readonly Entry[];
    render: (entry: Entry, context: { stage: HTMLElement; signal: AbortSignal }) => Promise<Dispose>;
    describe?: (description: string) => string;
  },
): Promise<() => Promise<void>> {
  const { entries, render, describe = escapeHtml } = options;
  target.innerHTML = template;
  const select = element<HTMLSelectElement>(target, '#spec');
  const title = element(target, '#spec-title');
  const meta = element(target, '#spec-meta');
  const stage = element(target, '#app');
  for (const entry of entries) select.append(new Option(entry.title, entry.id));

  let lifetime = new AbortController();
  let current: Promise<Dispose | undefined> = Promise.resolve(undefined);
  const settle = async (rendered: Promise<Dispose | undefined>) => {
    const dispose = await rendered.catch(() => undefined);
    await dispose?.();
  };
  const show = async (entry: Entry) => {
    lifetime.abort();
    const controller = new AbortController();
    lifetime = controller;
    select.value = entry.id;
    const previous = current;
    const rendered = (async () => {
      await settle(previous);
      controller.signal.throwIfAborted();
      title.textContent = entry.title;
      meta.innerHTML = entry.description ? describe(entry.description) : '';
      stage.replaceChildren();
      return render(entry, { stage, signal: controller.signal });
    })();
    current = rendered;
    await rendered.catch((error: unknown) => {
      if (!controller.signal.aborted) meta.textContent = `Render failed: ${String(error)}`;
    });
  };

  const fromHash = () => entries.find((entry) => `#${entry.id}` === window.location.hash);
  const onSelect = () => {
    const entry = entries.find(({ id }) => id === select.value);
    if (!entry) return;
    if (window.location.hash !== `#${entry.id}`) window.location.hash = entry.id;
    void show(entry);
  };
  const onHash = () => {
    const entry = fromHash();
    if (entry && entry.id !== select.value) void show(entry);
  };
  select.addEventListener('change', onSelect);
  window.addEventListener('hashchange', onHash);

  const initial = fromHash() ?? entries[0];
  if (initial) await show(initial);

  return async () => {
    select.removeEventListener('change', onSelect);
    window.removeEventListener('hashchange', onHash);
    lifetime.abort();
    await settle(current);
    target.replaceChildren();
  };
}
