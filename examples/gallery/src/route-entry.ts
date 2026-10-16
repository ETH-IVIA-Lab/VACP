import './gallery.css';
import { renderExampleError } from '@vacp/example-shared';
import { examples } from '../examples.manifest';

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

async function mountRoute(root: HTMLElement): Promise<void> {
  const route = document.body.dataset.vacpGalleryRoute ?? '';
  const entry = examples.find((example) => example.route === route);
  if (!entry) throw new Error(`Unknown example route: ${route}`);

  const target = renderRouteShell(root, entry.layout);
  try {
    const unmount = await (await entry.load()).mount(target);
    window.addEventListener('beforeunload', () => void unmount(), { once: true });
  } catch (error) {
    renderExampleError(target, `Failed to mount ${entry.id}: ${String(error)}`);
  }
}

const root = document.getElementById('gallery-example-root');
if (!root) throw new Error('Missing #gallery-example-root');
mountRoute(root).catch((error: unknown) => renderExampleError(root, error));
