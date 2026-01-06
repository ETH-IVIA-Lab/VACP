import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec, type Spec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVgplot, type VgplotPlotLike } from '@vacp/mosaic';
import { parse } from 'yaml';

async function waitForSvg(root: HTMLElement, timeoutMs = 10_000): Promise<SVGElement> {
  const start = performance.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const svg = root.querySelector('svg');
    if (svg) return svg;
    if (performance.now() - start > timeoutMs) throw new Error('Timed out waiting for SVG render');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

type GalleryMeta = { title: string; description?: string };
type GalleryEntry = { id: string; meta: GalleryMeta; yaml: string; spec: Spec };

function fileIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.ya?ml$/i, '');
}

function loadGallery(): GalleryEntry[] {
  const files = import.meta.glob('./specs/*.yaml', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;
  return Object.entries(files)
    .map(([path, yaml]) => {
      const parsed = parse(yaml) as Record<string, unknown>;
      const metaRaw = parsed.meta as Record<string, unknown> | undefined;
      const meta: GalleryMeta = {
        title: typeof metaRaw?.title === 'string' ? metaRaw.title : fileIdFromPath(path),
        description: typeof metaRaw?.description === 'string' ? metaRaw.description : undefined,
      };
      const specObj = { ...parsed };
      delete specObj.meta;
      return { id: fileIdFromPath(path), meta, yaml, spec: specObj as unknown as Spec };
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

  // Mosaic specs require a coordinator with a database connector. For in-browser
  // examples we use DuckDB-WASM.
  const mc = coordinator();
  mc.databaseConnector(new DuckDBWASMConnector({ log: false }));

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

  // Enable the overlay only when explicitly requested.
  // - `?vacpDebug=1`
  // - or localStorage `vacp:debug=1`
  installVacpDebugUi({ enabled: 'auto', globalKey: '__vacp' });

  async function render(entry: GalleryEntry): Promise<void> {
    diagramPre.textContent = '(loading…)';
    metaDiv.textContent = entry.meta.description ?? '';

    const ast = parseSpec(entry.spec);
    const api = createAPIContext({ coordinator: mc });
    const { element } = await astToDOM(ast, { api, baseURL: window.location.href });

    appRoot.replaceChildren(element);

    // Some Mosaic specs render multiple plots. For this minimal example we
    // attach to the first plot element found.
    const plotEl = element.querySelector<HTMLElement>('.plot');
    if (!plotEl) throw new Error('No vgplot element found');
    const plot = (plotEl as unknown as { value?: unknown }).value;
    if (!plot) throw new Error('vgplot element does not expose plot instance via .value');

    const svg = await waitForSvg(plotEl);
    installVacpOnVgplot(plot as VgplotPlotLike, svg, {
      appId: 'vacp-examples',
      viewId: `mosaic/${entry.id}`,
      plotId: 'plot-0',
      title: entry.meta.title,
      globalKey: '__vacp',
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
