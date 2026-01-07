import type { VacpCapabilitiesSnapshot, VacpDemo, VacpStateSnapshot } from '@vacp/core';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';
import { installVacpDebugUi } from '@vacp/debug-ui';
import { installVacpOnVegaLiteView, type VegaLiteSpecLike, type VegaViewLike } from '@vacp/vega-lite';
import embed, { type VisualizationSpec } from 'vega-embed';

type GalleryMeta = { id: string; title: string; description?: string };
type GalleryEntry = { id: string; meta: GalleryMeta; createSpec: () => VegaLiteSpecLike };

function buildDemos(entry: GalleryEntry): VacpDemo[] {
  const base = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  const steps: VacpDemo['steps'] =
    entry.id === 'bars-point-select'
      ? [
          {
            title: 'Set baseOpacity (low)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/baseOpacity`, value: 0.2 } },
          },
          {
            title: 'Set baseOpacity (high)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/baseOpacity`, value: 0.8 } },
          },
          {
            title: 'Apply state via debug override (baseOpacity)',
            description: 'Uses the opt-in debug apply-state action instead of the normal set_param action.',
            call: {
              name: 'vacp.apply_state',
              params: {
                state: {
                  [`${base}/param/baseOpacity`]: { kind: 'Param', name: 'baseOpacity', value: 0.35 },
                },
              },
            },
          },
          {
            title: 'Clear selection',
            description: 'If you selected a bar manually, this clears it.',
            call: { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/pick` } },
          },
        ]
      : [
          {
            title: 'Set pointSize (small)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/pointSize`, value: 12 } },
          },
          {
            title: 'Set pointSize (large)',
            call: { name: 'vega_lite.set_param', params: { ref: `${base}/param/pointSize`, value: 90 } },
          },
          {
            title: 'Apply state via debug override (pointSize)',
            call: {
              name: 'vacp.apply_state',
              params: {
                state: {
                  [`${base}/param/pointSize`]: { kind: 'Param', name: 'pointSize', value: 36 },
                },
              },
            },
          },
          {
            title: 'Clear brush selection',
            description: 'If you brushed the scatterplot manually, this clears it.',
            call: { name: 'vega_lite.clear_selection', params: { ref: `${base}/param/brush` } },
          },
        ];

  return [
    {
      id: `${entry.id}-params`,
      title: 'Params and selection',
      description:
        'Steps through programmatic parameter updates (agent-like) and shows how they appear in state/history.',
      steps,
    },
  ];
}

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

  let currentBridge: {
    getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
    getState: () => Promise<VacpStateSnapshot>;
    execute: (call: { callId: string; name: string; params?: unknown }) => Promise<{ ok: boolean; result?: unknown }>;
    subscribe?: (fn: () => void) => () => void;
    refresh?: (options?: { source?: 'human' | 'agent' | 'debug' | 'system'; message?: string }) => Promise<unknown>;
  } | null = null;
  let unsubscribe: (() => void) | null = null;

  function safeJson(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function validateDom(): { ok: boolean; details: string[] } {
    const details: string[] = [];
    const hasRootVacpRef = !!appRoot.getAttribute('data-vacp-ref');
    const hasRootInteractions = !!appRoot.getAttribute('data-interaction-vacp-actions');
    const svg = appRoot.querySelector('svg');
    const hasSvg = !!svg;
    const hasMeta = !!svg?.querySelector('metadata[type="application/vacp+json"]');
    details.push(`Root data-vacp-ref: ${hasRootVacpRef ? 'ok' : 'missing'}`);
    details.push(`Root data-interaction-vacp-actions: ${hasRootInteractions ? 'ok' : 'missing'}`);
    details.push(`SVG render: ${hasSvg ? 'ok' : 'missing'}`);
    details.push(`SVG <metadata type="application/vacp+json">: ${hasMeta ? 'ok' : 'missing'}`);
    return { ok: hasRootVacpRef && hasRootInteractions && !!hasMeta, details };
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
    checks.push(...validateDom().details);
    checksDiv.textContent = checks.join(' • ');
  }

  async function render(entry: GalleryEntry): Promise<void> {
    diagramPre.textContent = '(loading…)';
    statePre.textContent = '(loading…)';
    metaDiv.textContent = entry.meta.description ?? '';
    checksDiv.textContent = '(loading…)';

    appRoot.replaceChildren();
    const spec: VegaLiteSpecLike = entry.createSpec();
    const result = await embed(appRoot, spec as unknown as VisualizationSpec, { actions: false, renderer: 'svg' });
    // Expose for debugging / introspection in devtools.
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
        globalKey: '__vacp',
        includeSetSignalAction: false,
        demos: buildDemos(entry),
      },
    });

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
          refresh?: (options?: {
            source?: 'human' | 'agent' | 'debug' | 'system';
            message?: string;
          }) => Promise<unknown>;
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
      if (!currentBridge) throw new Error('No bridge available');
      const capabilities = await currentBridge.getCapabilities();
      const action = capabilities.graph.actions.find((a) => a.name === 'vega_lite.set_param');
      if (!action) throw new Error('No vega_lite.set_param action available');

      // Pick the first Param node and bump its current value.
      const paramNode = capabilities.graph.nodes.find((n) => n.kind === 'Param');
      if (!paramNode) throw new Error('No Param nodes found in this spec');

      const state = await currentBridge.getState();
      const cur = (state.state as Record<string, unknown>)[paramNode.ref];
      const curValue = cur && typeof cur === 'object' ? (cur as { value?: unknown }).value : undefined;
      const next =
        typeof curValue === 'number'
          ? curValue >= 0 && curValue <= 1
            ? Math.min(1, curValue + 0.1)
            : curValue + 10
          : 42;

      await currentBridge.execute({
        callId: crypto.randomUUID(),
        name: 'vega_lite.set_param',
        params: { ref: paramNode.ref, value: next },
      });
      await refreshDebug();
    } catch (err) {
      checksDiv.textContent = `Demo failed: ${String(err)}`;
    }
  });

  demoClearButton.addEventListener('click', async () => {
    try {
      if (!currentBridge) throw new Error('No bridge available');
      const capabilities = await currentBridge.getCapabilities();
      const action = capabilities.graph.actions.find((a) => a.name === 'vega_lite.clear_selection');
      if (!action) throw new Error('No vega_lite.clear_selection action available in this spec');

      const selNode = capabilities.graph.nodes.find((n) => n.kind === 'Selection');
      if (!selNode) throw new Error('No Selection nodes found in this spec');

      await currentBridge.execute({
        callId: crypto.randomUUID(),
        name: 'vega_lite.clear_selection',
        params: { ref: selNode.ref },
      });
      await refreshDebug();
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
