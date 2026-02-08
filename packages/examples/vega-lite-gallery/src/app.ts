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

  // Dev-only overlay: inspects the VACP bridge and provides time travel + actions + DuckDB SQL.
  void installVacpDebugUI();

  // Gallery UI: pick between small specs that each exercise a different VACP feature.
  const gallery = loadGallery();
  gallery.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.meta.title;
    selectEl.append(opt);
  });

  const url = new URL(window.location.href);
  const initialId = url.hash ? url.hash.slice(1) : '';
  const normalizedInitialId = initialId.replace(/^\d+-/, '');
  if (initialId && gallery.some((g) => g.id === initialId)) selectEl.value = initialId;
  else if (normalizedInitialId && gallery.some((g) => g.id === normalizedInitialId))
    selectEl.value = normalizedInitialId;
  else selectEl.value = gallery[0]?.id ?? '';

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

      // Workaround: in headless Chromium (used by agent-arena), Vega can complete the embed with an
      // empty DOM/canvas. A follow-up `runAsync` (after the current task) reliably makes the chart
      // visible for screenshots and agent runs.
      setTimeout(() => {
        void result.view.runAsync();
      }, 0);
    } finally {
      // Hardening: don't expose the Vega View handle on `window`.
      delete g.__vegaView;
    }
  };

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    window.location.hash = id;
    const entry = gallery.find((g) => g.id === id);
    if (entry) {
      void render(entry).catch((err) => {
        metaEl.textContent = `Render failed: ${String(err)}`;
      });
    }
  });

  const initial = gallery.find((g) => g.id === selectEl.value);
  if (initial) await render(initial);
}
