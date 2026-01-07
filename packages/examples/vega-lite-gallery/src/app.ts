import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVegaLiteView, type VegaViewLike } from '@vacp/vega-lite';
import embed, { type VisualizationSpec } from 'vega-embed';

import { buildDemos } from './demos';
import { loadGallery } from './gallery';
import type { GalleryEntry } from './gallery';

export async function run(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  const selectEl = document.querySelector<HTMLSelectElement>('#spec');
  const metaEl = document.querySelector<HTMLDivElement>('#spec-meta');
  if (!app || !selectEl || !metaEl) {
    throw new Error('Missing root elements');
  }

  const appRoot = app;
  const metaDiv = metaEl;

  const globalKey = '__vacp';
  installVacpDebugUi({ enabled: 'auto', globalKey });

  const gallery = loadGallery();
  gallery.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.meta.title;
    selectEl.append(opt);
  });

  const url = new URL(window.location.href);
  const initialId = url.hash ? url.hash.slice(1) : '';
  if (initialId && gallery.some((g) => g.id === initialId)) selectEl.value = initialId;
  else selectEl.value = gallery[0]?.id ?? '';

  const render = async (entry: GalleryEntry): Promise<void> => {
    metaDiv.textContent = entry.meta.description ?? '';

    appRoot.replaceChildren();
    const spec = entry.createSpec();
    const result = await embed(appRoot, spec as unknown as VisualizationSpec, { actions: false, renderer: 'svg' });
    (globalThis as unknown as { __vegaView?: unknown }).__vegaView = result.view;

    installVacpOnVegaLiteView({
      root: appRoot,
      view: result.view as unknown as VegaViewLike,
      spec,
      options: {
        appId: 'vacp-examples',
        viewId: `vega-lite/${entry.id}`,
        vizId: entry.id,
        title: entry.meta.title,
        globalKey,
        includeSetSignalAction: false,
        demos: buildDemos(entry),
      },
    });
  };

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    window.location.hash = id;
    const entry = gallery.find((g) => g.id === id);
    if (entry) {
      void render(entry).catch((err) => {
        metaDiv.textContent = `Render failed: ${String(err)}`;
      });
    }
  });

  const initial = gallery.find((g) => g.id === selectEl.value);
  if (initial) await render(initial);
}
