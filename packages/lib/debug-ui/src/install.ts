import type { VacpDemo, VacpRuntimeSnapshot } from '@vacp/core';
import { getBridge, readDemos, readRuntime } from './bridge';
import { shouldEnable } from './enabled';
import { renderMermaidToHost } from './mermaid';
import { renderActionsPane } from './panes/actions';
import { createInitialDataUiState, renderDataPane } from './panes/data';
import { mermaidSourceFromRuntime } from './panes/graph';
import { renderHistoryPane } from './panes/history';
import { renderJsonPane } from './panes/json';
import { renderDemoPane } from './panes/demo';
import { ensureStyles } from './styles';
import type { DebugTab, VacpDebugUiOptions, VacpWindowBridge } from './types';
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

type DockPos = { left: number; top: number };

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-root')) return;
  const globalKey = options?.globalKey ?? '__vacp';
  const direction = options?.direction ?? 'LR';
  const includeActions = options?.includeActions ?? true;
  const includeStatePreview = options?.includeStatePreview ?? true;
  ensureStyles();
  const root = document.createElement('div');
  root.id = 'vacp-debug-ui-root';
  root.setAttribute('data-vacp-debug-ui', '1');
  root.className = 'vacp-debug-ui-root';
  const button = document.createElement('button');
  button.className = 'vacp-debug-ui-button';
  button.type = 'button';
  button.textContent = 'VACP';
  button.title = 'Open VACP debug overlay';
  const panel = document.createElement('div');
  panel.className = 'vacp-debug-ui-panel';
  const header = document.createElement('header');
  const titleEl = document.createElement('div');
  titleEl.className = 'vacp-debug-ui-title';
  titleEl.textContent = `VACP Debug (${globalKey})`;

  const actionsEl = document.createElement('div');
  actionsEl.className = 'vacp-debug-ui-actions';

  const liveBtn = document.createElement('button');
  liveBtn.type = 'button';
  liveBtn.textContent = 'Live';
  liveBtn.title = 'Return to live mode (inspect cursor follows the latest entry)';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Step the inspect cursor backward through history (does not mutate the live app)';

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.textContent = 'Redo';
  redoBtn.title = 'Step the inspect cursor forward through history (does not mutate the live app)';

  const observeBtn = document.createElement('button');
  observeBtn.type = 'button';
  observeBtn.textContent = 'Observe: on';
  observeBtn.title = 'Toggle snapshot polling (useful when a provider cannot emit human interaction events)';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Capture a fresh snapshot into the runtime timeline';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy Mermaid';
  copyBtn.title = 'Copy the current Mermaid source to clipboard';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.title = 'Close the overlay (does not remove the VACP runtime)';

  actionsEl.append(liveBtn, undoBtn, redoBtn, observeBtn, refreshBtn, copyBtn, closeBtn);
  header.append(titleEl, actionsEl);

  const body = document.createElement('div');
  body.className = 'vacp-debug-ui-body';

  const svgHost = document.createElement('div');
  svgHost.className = 'vacp-debug-ui-svg';

  const codeHost = document.createElement('div');
  codeHost.className = 'vacp-debug-ui-code';

  const tabs = document.createElement('div');
  tabs.className = 'vacp-debug-ui-tabs';

  const tabButtons: Record<DebugTab, HTMLButtonElement> = {
    Graph: document.createElement('button'),
    Data: document.createElement('button'),
    Actions: document.createElement('button'),
    History: document.createElement('button'),
    Demo: document.createElement('button'),
    JSON: document.createElement('button'),
  };

  (Object.keys(tabButtons) as DebugTab[]).forEach((t) => {
    const b = tabButtons[t];
    b.type = 'button';
    b.className = 'vacp-debug-ui-tab';
    b.textContent = t;
    b.setAttribute('aria-selected', 'false');
    b.title =
      t === 'Graph'
        ? 'Rendered graph diagram + Mermaid source'
        : t === 'Data'
          ? 'Inspect and query the current DataHandle via DuckDB (vacp.data_sql)'
          : t === 'Actions'
            ? 'Manually dispatch semantic actions'
            : t === 'History'
              ? 'Inspect runtime timeline entries'
              : t === 'Demo'
                ? 'Step through provider-supplied demo scripts'
                : 'Override/apply state (inspect vs live)';
    tabs.append(b);
  });

  const panes: Record<DebugTab, HTMLElement> = {
    Graph: document.createElement('div'),
    Data: document.createElement('div'),
    Actions: document.createElement('div'),
    History: document.createElement('div'),
    Demo: document.createElement('div'),
    JSON: document.createElement('div'),
  };
  (Object.keys(panes) as DebugTab[]).forEach((t) => {
    panes[t].style.display = 'none';
  });

  codeHost.append(tabs, panes.Graph, panes.Data, panes.Actions, panes.History, panes.Demo, panes.JSON);
  body.append(svgHost, codeHost);
  panel.append(header, body);
  root.append(button, panel);
  document.body.append(root);

  const POS_KEY = 'vacp:debug:pos';
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const readPos = (): DockPos | null => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
      if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      return { left: parsed.left, top: parsed.top };
    } catch {
      return null;
    }
  };
  const savePos = (pos: DockPos) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      // ignore
    }
  };
  const applyPos = (pos: DockPos) => {
    const margin = 10;
    const rect = root.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    root.style.left = `${clamp(pos.left, margin, maxLeft)}px`;
    root.style.top = `${clamp(pos.top, margin, maxTop)}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  };
  const positionPanel = () => {
    const rect = root.getBoundingClientRect();
    const openDown = rect.top < window.innerHeight / 2;
    const openRight = rect.left < window.innerWidth / 2;
    const gap = 10;
    const btnRect = button.getBoundingClientRect();
    const btnH = btnRect.height || 40;

    panel.style.top = openDown ? `${btnH + gap}px` : 'auto';
    panel.style.bottom = openDown ? 'auto' : `${btnH + gap}px`;
    panel.style.left = openRight ? '0px' : 'auto';
    panel.style.right = openRight ? 'auto' : '0px';
  };

  queueMicrotask(() => {
    const saved = readPos();
    if (saved) {
      applyPos(saved);
    } else {
      const b = button.getBoundingClientRect();
      applyPos({ left: window.innerWidth - b.width - 14, top: window.innerHeight - b.height - 14 });
    }
    positionPanel();
  });

  window.addEventListener('resize', () => positionPanel());

  let currentTab: DebugTab = 'Graph';
  let observeEnabled = true;
  let lastMermaid = '';
  let unsubscribe: (() => void) | null = null;

  let demos: VacpDemo[] = [];
  let selectedDemoId: string | null = null;
  let selectedStepIdx = 0;

  const actionUi = { selectedAction: undefined as string | undefined, paramsText: '{}' };
  const dataUi = createInitialDataUiState();
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

  const installDrag = (handle: HTMLElement) => {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      applyPos({ left: startLeft + dx, top: startTop + dy });
      positionPanel();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const rect = root.getBoundingClientRect();
      savePos({ left: rect.left, top: rect.top });
    };

    handle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true;
      const rect = root.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      handle.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  };

  installDrag(button);
  installDrag(titleEl);

  const updateTitle = (rt: VacpRuntimeSnapshot) => {
    const rid = (rt.runtimeId ?? '').toString().slice(0, 8);
    titleEl.textContent = `VACP Debug (${globalKey}) • mode=${rt.mode} cursor=${rt.cursor} history=${rt.history.length} • runtime=${rid}`;
  };

  const render = async (bridge: VacpWindowBridge) => {
    activeBridge = bridge;
    const runtime = await readRuntime(bridge);
    updateTitle(runtime);

    const mermaid = mermaidSourceFromRuntime(runtime, { direction, includeActions, includeStatePreview });
    lastMermaid = mermaid;

    if (currentTab === 'Graph') {
      panes.Graph.textContent = '';
      const title = document.createElement('div');
      title.className = 'vacp-debug-ui-section-title';
      title.textContent = 'Mermaid';
      const code = document.createElement('div');
      code.className = 'vacp-debug-ui-small';
      code.textContent = mermaid;
      panes.Graph.append(title, code);
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
    if (currentTab === 'Demo') {
      renderDemoPane({
        container: panes.Demo,
        runtime,
        bridge,
        demos,
        selectedDemoId,
        selectedStepIdx,
        setSelected: (next) => {
          if (next.demoId !== undefined) selectedDemoId = next.demoId;
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
    if (!bridge) return;
    activeBridge = bridge;

    demos = await readDemos(bridge);
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
      positionPanel();
      void connect();
    }
  });
  closeBtn.addEventListener('click', () => setPanelVisible(panel, false));

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
}
