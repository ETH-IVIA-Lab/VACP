import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import type { VgplotPlotLike } from '@vacp/mosaic';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVgplotDashboard } from '@vacp/mosaic';
import { coordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { astToDOM, parseSpec } from '@uwdata/mosaic-spec';
import { createAPIContext } from '@uwdata/vgplot';

import { buildDemos } from './demos';
import type { GalleryEntry } from './gallery';
import { loadGallery } from './gallery';
import { wireDemoButtons } from './demo-buttons';
import { waitForSvg } from './vgplot-helpers';

type Bridge = {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  getState: () => Promise<VacpStateSnapshot>;
  execute: (call: { callId: string; name: string; params?: unknown }) => Promise<{ ok: boolean; result?: unknown }>;
  subscribe?: (fn: () => void) => () => void;
  refresh?: (options?: { source?: 'human' | 'agent' | 'debug' | 'system'; message?: string }) => Promise<unknown>;
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function validateDom(svg: SVGElement): boolean {
  const hasVacpRef = !!svg.getAttribute('data-vacp-ref');
  const hasInteraction = !!svg.getAttribute('data-interaction-vacp-actions');
  const hasMeta = !!svg.querySelector('metadata[type="application/vacp+json"]');
  return hasVacpRef && hasInteraction && hasMeta;
}

function getBridge(globalKey: string): Bridge | null {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  const v = anyGlobal[globalKey];
  if (!v || typeof v !== 'object') return null;
  const b = v as Partial<Bridge>;
  if (typeof b.getCapabilities !== 'function' || typeof b.getState !== 'function' || typeof b.execute !== 'function')
    return null;
  return b as Bridge;
}

function selectOption(selectEl: HTMLSelectElement, id: string): void {
  selectEl.value = id;
  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function run(): Promise<void> {
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

  const appRoot = app;
  const diagramPre = diagramEl;
  const statePre = stateEl;
  const checksDiv = checksEl;
  const refreshButton = refreshBtn;
  const demoSetButton = demoSetBtn;
  const demoClearButton = demoClearBtn;
  const metaDiv = metaEl;

  const globalKey = '__vacp';

  installVacpDebugUi({ enabled: 'auto', globalKey });

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

  let currentPlots: Array<{ plotId: string; plot: VgplotPlotLike }> = [];
  let currentSvgs: SVGElement[] = [];
  let currentBridge: Bridge | null = null;
  let unsubscribe: (() => void) | null = null;

  const refreshDebug = async (): Promise<void> => {
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
    if (currentSvgs.length) {
      const domOk = currentSvgs.every((s) => validateDom(s));
      checks.push(`SVG annotations: ${domOk ? 'ok' : 'missing'}`);
    }
    checksDiv.textContent = checks.join(' • ');
  };

  const render = async (entry: GalleryEntry): Promise<void> => {
    diagramPre.textContent = '(loading…)';
    statePre.textContent = '(loading…)';
    metaDiv.textContent = entry.meta.description ?? '';
    checksDiv.textContent = '(loading…)';

    const ast = parseSpec(entry.spec);
    const api = createAPIContext({ coordinator: mc });
    const { element } = await astToDOM(ast, { api, baseURL: window.location.href });
    appRoot.replaceChildren(element);

    const plotEls = element.classList.contains('plot')
      ? [element as HTMLElement]
      : Array.from(element.querySelectorAll<HTMLElement>('.plot'));
    if (!plotEls.length) throw new Error('No vgplot element(s) found');

    const plots = await Promise.all(
      plotEls.map(async (plotEl, idx) => {
        const plot = (plotEl as unknown as { value?: unknown }).value;
        if (!plot) throw new Error('vgplot element does not expose plot instance via .value');
        const svg = await waitForSvg(plotEl);
        return { plotId: `plot-${idx}`, plot: plot as VgplotPlotLike, svg };
      }),
    );

    currentSvgs = plots.map((p) => p.svg);
    installVacpOnVgplotDashboard({
      root: element,
      plots,
      options: {
        appId: 'vacp-examples',
        viewId: `mosaic/${entry.id}`,
        title: entry.meta.title,
        globalKey,
        demos: buildDemos(entry),
      },
    });

    currentPlots = plots.map((p) => ({ plotId: p.plotId, plot: p.plot }));
    if (plots[0]?.svg && !validateDom(plots[0].svg)) throw new Error('Missing SVG annotations');

    const bridge = getBridge(globalKey);
    if (!bridge) throw new Error(`window.${globalKey} not installed`);
    currentBridge = bridge;

    unsubscribe?.();
    unsubscribe = null;
    if (typeof bridge.subscribe === 'function') unsubscribe = bridge.subscribe(() => void refreshDebug());

    await refreshDebug();
  };

  refreshButton.addEventListener('click', () => void refreshDebug());

  wireDemoButtons({
    demoSetButton,
    demoClearButton,
    checksDiv,
    getContext: () => ({ bridge: currentBridge, plots: currentPlots }),
    refreshDebug,
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
  else if (gallery[0]) {
    selectOption(selectEl, gallery[0].id);
  }
}
