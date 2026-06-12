import { installVacpDebugUI } from '@vacp/kit';
import { type VegaViewLike } from '@vacp/vega-lite';
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

  // Debug overlay: inspects the VACP bridge and provides time travel, actions, and DuckDB SQL.
  void installVacpDebugUI();

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

  const render = async (entry: GalleryEntry): Promise<void> => {
    // Render: mount Vega-Lite into the page, then attach VACP on top of the Vega View.
    metaEl.textContent = entry.meta.description ?? '';

    app.replaceChildren();
    const spec = entry.createSpec();
    const g = globalThis as unknown as { __vegaView?: unknown };
    try {
      const result = await embed(app, spec as unknown as VisualizationSpec, { actions: false, renderer: 'canvas' });

      // VACP layer: exposes Vega params/selections as nodes/actions at `window.__vacp`.
      installVacp({
        root: app,
        view: result.view as unknown as VegaViewLike,
        spec: spec as unknown as VisualizationSpec,
        entry,
      });

      // Headless Chromium can finish Vega embedding with an empty DOM/canvas.
      // Queue a follow-up runAsync so screenshots and arena runs see the chart.
      setTimeout(() => {
        void result.view.runAsync();
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
