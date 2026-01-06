import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVegaLiteView, type VegaLiteSpecLike, type VegaViewLike } from '@vacp/vega-lite';
import embed, { type VisualizationSpec } from 'vega-embed';

type GalleryMeta = { id: string; title: string; description?: string };
type GalleryEntry = { id: string; meta: GalleryMeta; createSpec: () => VegaLiteSpecLike };

function fileIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.tsx?$/i, '');
}

function loadGallery(): GalleryEntry[] {
  const mods = import.meta.glob('./specs/*.ts', { eager: true }) as Record<
    string,
    { meta?: Partial<GalleryMeta>; createSpec?: () => VegaLiteSpecLike }
  >;

  return Object.entries(mods)
    .map(([path, mod]) => {
      const id = mod.meta?.id ?? fileIdFromPath(path);
      const title = mod.meta?.title ?? id;
      const description = mod.meta?.description;
      const createSpec = mod.createSpec ?? (() => ({}));
      return { id, meta: { id, title, description }, createSpec };
    })
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}

async function main() {
  const app = document.querySelector<HTMLDivElement>('#app');
  const diagramEl = document.querySelector<HTMLPreElement>('#diagram');
  const selectEl = document.querySelector<HTMLSelectElement>('#spec');
  const metaEl = document.querySelector<HTMLDivElement>('#spec-meta');
  if (!app || !diagramEl || !selectEl || !metaEl) throw new Error('Missing root elements');

  // Re-bind DOM references to stable non-null locals so nested closures don't
  // lose control-flow narrowing.
  const appRoot = app;
  const diagramPre = diagramEl;
  const metaDiv = metaEl;

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

  installVacpDebugUi({ enabled: 'auto', globalKey: '__vacp' });

  async function render(entry: GalleryEntry): Promise<void> {
    diagramPre.textContent = '(loading…)';
    metaDiv.textContent = entry.meta.description ?? '';

    appRoot.replaceChildren();
    const spec: VegaLiteSpecLike = entry.createSpec();
    const result = await embed(appRoot, spec as unknown as VisualizationSpec, { actions: false, renderer: 'svg' });

    installVacpOnVegaLiteView({
      root: appRoot,
      view: result.view as unknown as VegaViewLike,
      spec,
      options: {
        appId: 'vacp-examples',
        viewId: `vega-lite/${entry.id}`,
        vizId: entry.id,
        title: entry.meta.title,
        globalKey: '__vacp',
        includeSetSignalAction: false,
      },
    });

    const bridge = (
      globalThis as unknown as {
        __vacp?: {
          getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
          getState: () => Promise<VacpStateSnapshot>;
        };
      }
    ).__vacp;
    if (!bridge) throw new Error('window.__vacp not installed');

    const [capabilities, state] = await Promise.all([bridge.getCapabilities(), bridge.getState()]);
    const diagram = renderVacpDiagramMermaid({
      capabilities,
      state,
      options: { direction: 'LR', includeActions: true, includeStatePreview: true },
    });
    diagramPre.textContent = `\`\`\`mermaid\n${diagram}\n\`\`\``;
  }

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    window.location.hash = id;
    const entry = gallery.find((g) => g.id === id);
    if (entry) void render(entry);
  });

  const initial = gallery.find((g) => g.id === selectEl.value);
  if (initial) await render(initial);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const diagramEl = document.querySelector<HTMLPreElement>('#diagram');
  if (diagramEl) diagramEl.textContent = String(err);
});
