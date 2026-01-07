import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec, type Spec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVgplot, type VgplotPlotLike } from '@vacp/mosaic';
import { parse } from 'yaml';

async function waitForSvg(root: ParentNode, timeoutMs = 10_000): Promise<SVGElement> {
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
  const stateEl = document.querySelector<HTMLPreElement>('#state');
  const checksEl = document.querySelector<HTMLDivElement>('#checks');
  const refreshBtn = document.querySelector<HTMLButtonElement>('#refresh');
  const demoSetBtn = document.querySelector<HTMLButtonElement>('#demo-set');
  const demoClearBtn = document.querySelector<HTMLButtonElement>('#demo-clear');
  const selectEl = document.querySelector<HTMLSelectElement>('#spec');
  const metaEl = document.querySelector<HTMLDivElement>('#spec-meta');
  if (
    !app ||
    !diagramEl ||
    !stateEl ||
    !checksEl ||
    !refreshBtn ||
    !demoSetBtn ||
    !demoClearBtn ||
    !selectEl ||
    !metaEl
  ) {
    throw new Error('Missing root elements');
  }

  // Re-bind DOM references to stable non-null locals so nested closures don't
  // lose control-flow narrowing.
  const appRoot = app;
  const diagramPre = diagramEl;
  const statePre = stateEl;
  const checksDiv = checksEl;
  const refreshButton = refreshBtn;
  const demoSetButton = demoSetBtn;
  const demoClearButton = demoClearBtn;
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

  let currentPlot: VgplotPlotLike | null = null;
  let currentBridge: {
    getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
    getState: () => Promise<VacpStateSnapshot>;
    execute: (call: { callId: string; name: string; params?: unknown }) => Promise<{ ok: boolean; result?: unknown }>;
    subscribe?: (fn: () => void) => () => void;
    refresh?: (options?: { source?: 'human' | 'agent' | 'debug' | 'system'; message?: string }) => Promise<unknown>;
  } | null = null;
  let currentSvg: SVGElement | null = null;
  let unsubscribe: (() => void) | null = null;

  function safeJson(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function validateDom(svg: SVGElement): { ok: boolean; details: string[] } {
    const details: string[] = [];
    const hasVacpRef = !!svg.getAttribute('data-vacp-ref');
    const hasInteraction = !!svg.getAttribute('data-interaction-vacp-actions');
    const hasMeta = !!svg.querySelector('metadata[type="application/vacp+json"]');
    details.push(`SVG data-vacp-ref: ${hasVacpRef ? 'ok' : 'missing'}`);
    details.push(`SVG data-interaction-vacp-actions: ${hasInteraction ? 'ok' : 'missing'}`);
    details.push(`SVG <metadata type="application/vacp+json">: ${hasMeta ? 'ok' : 'missing'}`);
    return { ok: hasVacpRef && hasInteraction && hasMeta, details };
  }

  function numericDomain(scale: unknown): [number, number] | null {
    const anyScale = scale as { domain?: unknown };
    const d = typeof anyScale?.domain === 'function' ? (anyScale.domain as () => unknown)() : anyScale?.domain;
    if (!Array.isArray(d) || d.length < 2) return null;
    const a = Number(d[0]);
    const b = Number(d[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [a, b];
  }

  function pickInterval1D(plot: VgplotPlotLike): { interactorId: string; domain: [number, number] | null } | null {
    for (let i = 0; i < plot.interactors.length; i++) {
      const it = plot.interactors[i];
      if (it.constructor?.name !== 'Interval1D') continue;
      const anyI = it as unknown as { scale?: unknown };
      return { interactorId: String(i), domain: numericDomain(anyI.scale) };
    }
    return null;
  }

  function pickInterval2D(plot: VgplotPlotLike): {
    interactorId: string;
    x: [number, number] | null;
    y: [number, number] | null;
  } | null {
    for (let i = 0; i < plot.interactors.length; i++) {
      const it = plot.interactors[i];
      if (it.constructor?.name !== 'Interval2D') continue;
      const anyI = it as unknown as { xscale?: unknown; yscale?: unknown };
      return { interactorId: String(i), x: numericDomain(anyI.xscale), y: numericDomain(anyI.yscale) };
    }
    return null;
  }

  async function refreshDebug(): Promise<void> {
    if (!currentBridge) {
      checksDiv.textContent = 'No bridge installed.';
      statePre.textContent = '';
      diagramPre.textContent = '';
      return;
    }
    const [capabilities, state] = await Promise.all([currentBridge.getCapabilities(), currentBridge.getState()]);
    statePre.textContent = safeJson(state);
    const diagram = renderVacpDiagramMermaid({
      capabilities,
      state,
      options: { direction: 'LR', includeActions: true, includeStatePreview: true },
    });
    diagramPre.textContent = `\`\`\`mermaid\n${diagram}\n\`\`\``;

    const checks: string[] = [];
    checks.push(`Bridge: ok (actions=${capabilities.graph.actions.length}, nodes=${capabilities.graph.nodes.length})`);
    if (currentSvg) {
      const dom = validateDom(currentSvg);
      checks.push(...dom.details);
    }
    checksDiv.textContent = checks.join(' • ');
  }

  async function render(entry: GalleryEntry): Promise<void> {
    diagramPre.textContent = '(loading…)';
    statePre.textContent = '(loading…)';
    metaDiv.textContent = entry.meta.description ?? '';
    checksDiv.textContent = '(loading…)';

    const ast = parseSpec(entry.spec);
    const api = createAPIContext({ coordinator: mc });
    const { element } = await astToDOM(ast, { api, baseURL: window.location.href });

    appRoot.replaceChildren(element);

    // Mosaic's astToDOM can return either a wrapper that *contains* `.plot`
    // elements or the `.plot` element itself. Treat both shapes uniformly.
    const plotEl = element.classList.contains('plot') ? element : element.querySelector<HTMLElement>('.plot');
    if (!plotEl) throw new Error('No vgplot element found');
    const plot = (plotEl as unknown as { value?: unknown }).value;
    if (!plot) throw new Error('vgplot element does not expose plot instance via .value');

    const svg = await waitForSvg(plotEl);
    currentSvg = svg;
    installVacpOnVgplot(plot as VgplotPlotLike, svg, {
      appId: 'vacp-examples',
      viewId: `mosaic/${entry.id}`,
      plotId: 'plot-0',
      title: entry.meta.title,
      globalKey: '__vacp',
      includeApplyStateAction: true,
    });

    currentPlot = plot as VgplotPlotLike;
    const bridge = (
      globalThis as unknown as {
        __vacp?: {
          getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
          getState: () => Promise<VacpStateSnapshot>;
          execute: (call: {
            callId: string;
            name: string;
            params?: unknown;
          }) => Promise<{ ok: boolean; result?: unknown }>;
          subscribe?: (fn: () => void) => () => void;
          refresh?: (options?: { source?: 'human' | 'agent' | 'debug' | 'system'; message?: string }) => Promise<unknown>;
        };
      }
    ).__vacp;
    if (!bridge) throw new Error('window.__vacp not installed');
    currentBridge = bridge;

    unsubscribe?.();
    unsubscribe = null;
    if (typeof bridge.subscribe === 'function') {
      unsubscribe = bridge.subscribe(() => void refreshDebug());
    }

    await refreshDebug();
  }

  refreshButton.addEventListener('click', () => void refreshDebug());
  demoSetButton.addEventListener('click', async () => {
    try {
      if (!currentBridge || !currentPlot) throw new Error('No plot/bridge available');
      const i2d = pickInterval2D(currentPlot);
      if (i2d) {
        const [x0, x1] = i2d.x ?? [0, 1];
        const [y0, y1] = i2d.y ?? [0, 1];
        const xa = x0 + 0.25 * (x1 - x0);
        const xb = x0 + 0.75 * (x1 - x0);
        const ya = y0 + 0.25 * (y1 - y0);
        const yb = y0 + 0.75 * (y1 - y0);
        await currentBridge.execute({
          callId: crypto.randomUUID(),
          name: 'mosaic.set_interval_2d',
          params: { interactorId: i2d.interactorId, x0: xa, x1: xb, y0: ya, y1: yb },
        });
        await refreshDebug();
        return;
      }

      const i1d = pickInterval1D(currentPlot);
      if (i1d) {
        const [d0, d1] = i1d.domain ?? [0, 1];
        const a = d0 + 0.25 * (d1 - d0);
        const b = d0 + 0.75 * (d1 - d0);
        await currentBridge.execute({
          callId: crypto.randomUUID(),
          name: 'mosaic.set_interval_1d',
          params: { interactorId: i1d.interactorId, min: a, max: b },
        });
        await refreshDebug();
        return;
      }

      throw new Error('No Interval1D/Interval2D interactor found in this spec');
    } catch (err) {
      checksDiv.textContent = `Demo failed: ${String(err)}`;
    }
  });

  demoClearButton.addEventListener('click', async () => {
    try {
      if (!currentBridge || !currentPlot) throw new Error('No plot/bridge available');
      const i2d = pickInterval2D(currentPlot);
      if (i2d) {
        await currentBridge.execute({
          callId: crypto.randomUUID(),
          name: 'mosaic.clear_interval_2d',
          params: { interactorId: i2d.interactorId },
        });
        await refreshDebug();
        return;
      }
      const i1d = pickInterval1D(currentPlot);
      if (i1d) {
        await currentBridge.execute({
          callId: crypto.randomUUID(),
          name: 'mosaic.clear_interval_1d',
          params: { interactorId: i1d.interactorId },
        });
        await refreshDebug();
        return;
      }
      throw new Error('No Interval1D/Interval2D interactor found in this spec');
    } catch (err) {
      checksDiv.textContent = `Clear failed: ${String(err)}`;
    }
  });

  selectEl.addEventListener('change', () => {
    const id = selectEl.value;
    window.location.hash = id;
    const entry = gallery.find((g) => g.id === id);
    if (entry) {
      void render(entry).catch((err) => {
        checksDiv.textContent = `Render failed: ${String(err)}`;
        diagramPre.textContent = String(err);
      });
    }
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
