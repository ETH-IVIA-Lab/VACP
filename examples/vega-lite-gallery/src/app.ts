import { type VegaViewLike } from '@vacp/adapter-vega-lite';
import embed, { type VisualizationSpec } from 'vega-embed';

import { loadGallery } from './gallery';
import type { GalleryEntry } from './gallery';
import { installVacp } from './vacp';

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const selectEl = document.querySelector<HTMLSelectElement>('#spec');
  const metaEl = document.querySelector<HTMLDivElement>('#spec-meta');

  if (!app || !selectEl || !metaEl) {
    throw new Error('Missing root elements');
  }

  // Gallery UI: pick between small specs that each exercise a different VACP feature.
  const gallery = loadGallery();
  gallery.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.meta.title;
    selectEl.append(opt);
  });

  const findGalleryEntry = (id: string): GalleryEntry | undefined => gallery.find((g) => g.id === id);

  const selectIdFromHash = (): string | null => {
    let rawHash = window.location.hash;

    try {
      rawHash = decodeURIComponent(rawHash);
    } catch {
      // Keep raw hash if decoding fails.
    }

    rawHash = rawHash.replace(/^#/, '').trim();

    if (!rawHash) return null;

    if (findGalleryEntry(rawHash)) return rawHash;
    const normalizedHash = rawHash.replace(/^\d+-/, '');

    if (findGalleryEntry(normalizedHash)) return normalizedHash;

    return null;
  };

  let activeView: Awaited<ReturnType<typeof embed>> | undefined;
  let renderVersion = 0;
  const render = async (entry: GalleryEntry): Promise<void> => {
    const version = ++renderVersion;
    activeView?.finalize();
    activeView = undefined;
    // Render: mount Vega-Lite into the page, then attach VACP on top of the Vega View.
    metaEl.textContent = entry.meta.description ?? '';

    app.replaceChildren();
    const spec = entry.createSpec();
    const g = globalThis as { __vegaView?: unknown };

    try {
      const result = await embed(app, spec as VisualizationSpec, { actions: false, renderer: 'canvas' });
      if (version !== renderVersion) {
        result.finalize();
        return;
      }
      activeView = result;

      // VACP layer: exposes Vega params/selections as nodes/actions at `window.__vacp`.
      await installVacp({
        root: app,
        view: result.view as VegaViewLike,
        spec: spec as VisualizationSpec,
        entry,
      });

      // Headless Chromium can finish Vega embedding with an empty DOM/canvas.
      // Queue a follow-up runAsync so screenshots see the chart.
      setTimeout(() => {
        if (activeView === result) void result.view.runAsync();
      }, 0);
    } finally {
      // Keep the Vega View handle off window after installation.
      delete g.__vegaView;
    }
  };

  const renderById = (id: string): void => {
    const entry = findGalleryEntry(id);

    if (!entry) return;

    if (selectEl.value !== id) selectEl.value = id;
    void render(entry).catch((err) => {
      metaEl.textContent = `Render failed: ${String(err)}`;
    });
  };

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;

    if (window.location.hash !== `#${id}`) window.location.hash = id;
    renderById(id);
  });

  window.addEventListener('hashchange', () => {
    const hashId = selectIdFromHash();

    if (!hashId || hashId === selectEl.value) return;
    renderById(hashId);
  });

  const initialId = selectIdFromHash() ?? gallery[0]?.id ?? '';

  if (initialId) {
    const initialEntry = findGalleryEntry(initialId);

    if (initialEntry) {
      if (selectEl.value !== initialId) selectEl.value = initialId;
      await render(initialEntry).catch((err) => {
        metaEl.textContent = `Render failed: ${String(err)}`;
      });
    }
  }
}
