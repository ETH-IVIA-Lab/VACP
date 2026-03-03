import './gallery.css';
import rawManifest from '../examples.manifest.json';
import type { ExampleModule, ExampleUnmount } from './contracts';
import { normalizeManifest } from './contracts';

const entries = normalizeManifest(rawManifest);

const moduleLoaders: Record<string, () => Promise<unknown>> = {
  ...import.meta.glob('../../*/src/mfe.ts'),
  ...import.meta.glob('../../*/src/mfe.tsx'),
};

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function renderError(root: HTMLElement, message: string): void {
  root.innerHTML = `<pre class="gallery-error">${escapeHtml(message)}</pre>`;
}

function renderRouteShell(root: HTMLElement, title: string): HTMLElement {
  const safeTitle = escapeHtml(title);
  root.innerHTML = `
    <main class="gallery-route">
      <header class="gallery-route__header">
        <a class="gallery-route__back" href="../">VACP Examples</a>
        <h1>${safeTitle}</h1>
      </header>
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
  const mountRoot = renderRouteShell(root, entry.title);

  const loader = moduleLoaders[entry.adapterModule];
  if (!loader) {
    renderError(mountRoot, `Missing adapter module: ${entry.adapterModule}`);
    return;
  }

  const loaded = (await loader()) as ExampleModule | { default?: ExampleModule };
  const mod = (loaded as { default?: ExampleModule }).default ?? (loaded as ExampleModule);
  if (!mod || typeof mod.mount !== 'function') {
    renderError(mountRoot, `Adapter module does not export mount(): ${entry.adapterModule}`);
    return;
  }

  let unmount: ExampleUnmount;
  try {
    unmount = await mod.mount(mountRoot);
  } catch (error) {
    renderError(mountRoot, `Failed to mount ${entry.id}: ${String(error)}`);
    return;
  }

  if (typeof unmount === 'function') {
    window.addEventListener('beforeunload', () => {
      void unmount();
    });
  }
}

void mountRoute();
