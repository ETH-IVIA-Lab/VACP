import type { VacpPlaybook, VacpRuntimeSnapshot } from '@vacp/core';
import { getBridge, readPlaybooks, readRuntime } from './bridge';
import { createVacpDebugDock } from './dock';
import { shouldEnable } from './enabled';
import { renderMermaidToHost } from './mermaid';
import { renderActionsPane } from './panes/actions';
import { createInitialDataUiState, renderDataPane } from './panes/data';
import { renderGraphPane, type GraphUiState } from './panes/graph-pane';
import { mermaidSourceFromRuntime } from './panes/graph';
import { renderHistoryPane } from './panes/history';
import { renderJsonPane } from './panes/json';
import { renderPlaybookPane } from './panes/playbook';
import { installVacpDebugResizer } from './resize';
import { installVacpDebugShortcuts } from './shortcuts';
import { ensureStyles } from './styles';
import type { DebugTab, VacpDebugUiOptions, VacpWindowBridge } from './types';
import { createVacpDebugUiDom } from './ui';
function copyText(text: string): void {
  const t = text ?? '';
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(t).catch(() => {});
    return;
  }
  const el = document.createElement('textarea');
  el.value = t;
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.append(el);
  el.select();
  try {
    document.execCommand('copy');
  } catch {
    // ignore
  } finally {
    el.remove();
  }
}
function setPanelVisible(panel: HTMLElement, visible: boolean): void {
  panel.style.display = visible ? 'block' : 'none';
}
function isPanelVisible(panel: HTMLElement): boolean {
  return getComputedStyle(panel).display !== 'none';
}

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-root')) return;
  const globalKey = options?.globalKey ?? '__vacp';
  const initialDirection = options?.direction ?? 'LR';
  const initialIncludeActions = options?.includeActions ?? true;
  const initialIncludeStatePreview = options?.includeStatePreview ?? true;
  ensureStyles();
  const dom = createVacpDebugUiDom({ globalKey });
  const {
    root,
    button,
    panel,
    titleEl,
    layoutBtn,
    liveBtn,
    undoBtn,
    redoBtn,
    observeBtn,
    refreshBtn,
    copyBtn,
    closeBtn,
  } = dom;
  const { tabButtons, panes, svgHost } = dom;
  document.body.append(root);

  const dock = createVacpDebugDock({
    root,
    panel,
    button,
    titleEl,
    storageKey: 'vacp:debug:pos',
  });
  dock.attach();
  installVacpDebugResizer({
    panel,
    storageKey: 'vacp:debug:size',
    onResizeEnd: () => dock.snapToNearest({ animate: false }),
  });

  let currentTab: DebugTab = 'Graph';
  let observeEnabled = true;
  let lastMermaid = '';
  let unsubscribe: (() => void) | null = null;

  type LayoutMode = 'split' | 'inspector' | 'diagram';
  const LAYOUT_KEY = 'vacp:debug:layout';
  const readLayout = (): LayoutMode => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw === 'inspector' || raw === 'diagram' || raw === 'split') return raw;
      return 'split';
    } catch {
      return 'split';
    }
  };
  const saveLayout = (mode: LayoutMode) => {
    try {
      localStorage.setItem(LAYOUT_KEY, mode);
    } catch {
      // ignore
    }
  };
  let layout: LayoutMode = readLayout();

  let playbooks: VacpPlaybook[] = [];
  let selectedPlaybookId: string | null = null;
  let selectedStepIdx = 0;

  const actionUi = { selectedAction: undefined as string | undefined, paramsText: '{}' };
  const dataUi = createInitialDataUiState();
  const graphUi: GraphUiState = {
    direction: initialDirection,
    includeActions: initialIncludeActions,
    includeStatePreview: initialIncludeStatePreview,
  };
  const jsonUi = { text: '{}' };
  let activeBridge: VacpWindowBridge | null = null;
  let pendingRender = false;
  const dbg = (message: string) => ({ source: 'debug' as const, message });

  const setTab = (next: DebugTab) => {
    currentTab = next;
    (Object.keys(tabButtons) as DebugTab[]).forEach((t) =>
      tabButtons[t].setAttribute('aria-selected', t === next ? 'true' : 'false'),
    );
    (Object.keys(panes) as DebugTab[]).forEach((t) => {
      panes[t].style.display = t === next ? 'block' : 'none';
    });
  };
  setTab('Graph');

  const applyLayout = () => {
    layoutBtn.textContent = `Layout: ${layout}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = panel.querySelector('.vacp-debug-ui-body') as any as HTMLElement | null;
    if (body) body.setAttribute('data-layout', layout);
    dock.positionPanel();
  };
  applyLayout();

  const updateTitle = (rt: VacpRuntimeSnapshot) => {
    const rid = (rt.runtimeId ?? '').toString().slice(0, 8);
    titleEl.textContent = `VACP Debug (${globalKey}) • mode=${rt.mode} cursor=${rt.cursor} history=${rt.history.length} • runtime=${rid}`;
  };

  const render = async (bridge: VacpWindowBridge) => {
    activeBridge = bridge;
    const runtime = await readRuntime(bridge);
    updateTitle(runtime);

    const mermaid = mermaidSourceFromRuntime(runtime, {
      direction: graphUi.direction,
      includeActions: graphUi.includeActions,
      includeStatePreview: graphUi.includeStatePreview,
    });
    lastMermaid = mermaid;

    if (currentTab === 'Graph') {
      renderGraphPane({
        container: panes.Graph,
        mermaid,
        state: graphUi,
        onChange: (next) => {
          Object.assign(graphUi, next);
          requestRender();
        },
      });
    }

    if (currentTab === 'Data') {
      await renderDataPane({
        container: panes.Data,
        runtime,
        bridge,
        state: dataUi,
        onChange: (next) => {
          Object.assign(dataUi, next);
          requestRender();
        },
      });
    }

    if (currentTab === 'History') renderHistoryPane(panes.History, runtime, bridge);
    if (currentTab === 'Actions') {
      renderActionsPane(panes.Actions, runtime, bridge, actionUi, (next) => {
        Object.assign(actionUi, next);
        requestRender();
      });
    }
    if (currentTab === 'Playbook') {
      renderPlaybookPane({
        container: panes.Playbook,
        runtime,
        bridge,
        playbooks,
        selectedId: selectedPlaybookId,
        selectedStepIdx,
        setSelected: (next) => {
          if (next.playbookId !== undefined) selectedPlaybookId = next.playbookId;
          if (next.stepIdx !== undefined) selectedStepIdx = next.stepIdx;
          requestRender();
        },
      });
    }
    if (currentTab === 'JSON')
      renderJsonPane(panes.JSON, runtime, bridge, jsonUi, (next) => Object.assign(jsonUi, next));

    await renderMermaidToHost(svgHost, mermaid);
  };

  const requestRender = () => {
    if (!activeBridge) return;
    if (!isPanelVisible(panel)) return;
    if (pendingRender) return;
    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      if (!activeBridge || !isPanelVisible(panel)) return;
      void render(activeBridge);
    });
  };

  (Object.keys(tabButtons) as DebugTab[]).forEach((t) =>
    tabButtons[t].addEventListener('click', () => {
      setTab(t);
      requestRender();
    }),
  );

  const connect = async () => {
    const bridge = getBridge(globalKey);
    if (!bridge) {
      svgHost.textContent = '';
      svgHost.append(document.createTextNode('No VACP bridge found on this page.'));
      panes.Graph.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'vacp-debug-ui-small';
      msg.textContent = `Expected window.${globalKey} with getCapabilities/getState/execute.\n\nTip: enable VACP in the app (provider install) and reload.`;
      panes.Graph.append(msg);
      return;
    }
    activeBridge = bridge;

    playbooks = await readPlaybooks(bridge);
    if (typeof bridge.subscribe === 'function') {
      unsubscribe?.();
      unsubscribe = bridge.subscribe(() => {
        if (isPanelVisible(panel)) void render(bridge);
      });
    }
    await render(bridge);
  };

  const withBridge = async (fn: (bridge: VacpWindowBridge) => Promise<void> | void) => {
    const bridge = getBridge(globalKey);
    if (!bridge) return;
    activeBridge = bridge;
    await fn(bridge);
    if (isPanelVisible(panel)) await render(bridge);
  };

  button.addEventListener('click', () => {
    setPanelVisible(panel, !isPanelVisible(panel));
    if (isPanelVisible(panel)) {
      dock.positionPanel();
      void connect();
    }
  });
  closeBtn.addEventListener('click', () => setPanelVisible(panel, false));

  layoutBtn.addEventListener('click', () => {
    layout = layout === 'split' ? 'inspector' : layout === 'inspector' ? 'diagram' : 'split';
    saveLayout(layout);
    applyLayout();
  });

  liveBtn.addEventListener('click', () => void withBridge((b) => b.setMode?.('live', dbg('live'))));
  undoBtn.addEventListener('click', () => void withBridge((b) => b.undo?.(dbg('undo'))));
  redoBtn.addEventListener('click', () => void withBridge((b) => b.redo?.(dbg('redo'))));

  observeBtn.addEventListener('click', () => {
    observeEnabled = !observeEnabled;
    observeBtn.textContent = observeEnabled ? 'Observe: on' : 'Observe: off';
    void withBridge((b) => {
      if (observeEnabled) b.startObserving?.(dbg('observe'));
      else b.stopObserving?.();
    });
  });

  refreshBtn.addEventListener('click', () => void withBridge(async (b) => void (await b.refresh?.(dbg('refresh')))));
  copyBtn.addEventListener('click', () => copyText(lastMermaid));

  installVacpDebugShortcuts({
    isPanelVisible: () => isPanelVisible(panel),
    setPanelVisible: (v) => setPanelVisible(panel, v),
    setTab,
    requestRender,
    cycleLayout: () => layoutBtn.click(),
    refresh: () => refreshBtn.click(),
  });
}
