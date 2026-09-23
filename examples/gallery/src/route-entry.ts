import './gallery.css';
import { examples as entries } from '../examples.manifest';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderError(root: HTMLElement, message: string): void {
  root.innerHTML = `<pre class="gallery-error">${escapeHtml(message)}</pre>`;
}

/** A shared frame only: each example owns its own heading and describes its own data. */
function renderRouteShell(root: HTMLElement, layout = 'viewport'): HTMLElement {
  root.innerHTML = `
    <main class="gallery-route" data-layout="${layout}">
      <nav class="gallery-route__nav" aria-label="Examples"><a href="../">All examples</a></nav>
      <section class="gallery-route__content">
        <div id="gallery-example-mount"></div>
      </section>
    </main>
  `;
  const mount = root.querySelector<HTMLElement>('#gallery-example-mount');

  if (!mount) throw new Error('Missing #gallery-example-mount');

  return mount;
}

async function mountRoute(): Promise<void> {
  const root = document.getElementById('gallery-example-root');

  if (!root) throw new Error('Missing #gallery-example-root');

  const route = document.body.dataset.vacpGalleryRoute ?? '';
  const entry = entries.find((e) => e.route === route);

  if (!entry) {
    renderError(root, `Unknown example route: ${route}`);

    return;
  }

  const mountRoot = renderRouteShell(root, entry.layout);

  let unmount: void | (() => void | Promise<void>);

  try {
    const module = await entry.load();
    unmount = await module.mount(mountRoot);
  } catch (error) {
    renderError(mountRoot, `Failed to mount ${entry.id}: ${String(error)}`);

    return;
  }

  if (unmount) {
    window.addEventListener('beforeunload', () => {
      void unmount();
    });
  }
}

void mountRoute();
