import type { VacpPlaybook, VacpRuntimeSnapshot } from '@vacp/core';

import { getBridge, readPlaybooks, readRuntime } from './bridge';
import { createVacpDebugDock } from './dock';
import { shouldEnable } from './enabled';
import { createDefaultModules } from './modules';
import { installVacpDebugResizer } from './resize';
import { installVacpDebugShortcuts } from './shortcuts';
import { ensureStyles } from './styles';
import type { VacpDebugModule, VacpDebugModuleId, VacpDebugUiOptions, VacpWindowBridge } from './types';
import { createVacpDebugUiDom } from './ui';

function setPanelVisible(panel: HTMLElement, visible: boolean): void {
  panel.style.display = visible ? 'grid' : 'none';
}

function isPanelVisible(panel: HTMLElement): boolean {
  return getComputedStyle(panel).display !== 'none';
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-root')) return;

  const globalKey = options?.globalKey ?? '__vacp';
  const initialIncludeActions = options?.includeActions ?? true;
  const initialIncludeStatePreview = options?.includeStatePreview ?? true;

  ensureStyles();

  const dom = createVacpDebugUiDom({ globalKey });
  const { root, button, panel, titleEl, moduleSelect, moduleList, content, closeBtn } = dom;

  document.body.append(root);
  document.body.append(panel);

  const panelPosition = () => {
    if (!isPanelVisible(panel)) return;
    const margin = 10;
    const gap = 10;
    const dockRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const w = panelRect.width;
    const h = panelRect.height;

    const openRight = dockRect.left < window.innerWidth / 2;
    const openDown = dockRect.top < window.innerHeight / 2;
    let left = openRight ? dockRect.left : dockRect.right - w;
    let top = openDown ? dockRect.bottom + gap : dockRect.top - gap - h;

    left = clamp(left, margin, Math.max(margin, window.innerWidth - w - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - h - margin));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const dock = createVacpDebugDock({
    root,
    handles: [button],
    storageKey: 'vacp:debug:pos',
    onMove: () => panelPosition(),
    onDrop: () => panelPosition(),
  });
  dock.attach();

  installVacpDebugResizer({
    panel,
    storageKey: 'vacp:debug:size',
    onResizeEnd: () => panelPosition(),
  });

  const modules: VacpDebugModule[] =
    options?.modules ??
    createDefaultModules({
      includeActions: initialIncludeActions,
      includeStatePreview: initialIncludeStatePreview,
    });

  const MODULE_KEY = 'vacp:debug:module';
  const readModuleId = (): VacpDebugModuleId => {
    try {
      const raw = localStorage.getItem(MODULE_KEY);
      if (raw && modules.some((m) => m.id === raw)) return raw;
      return modules[0]?.id ?? 'graph';
    } catch {
      return modules[0]?.id ?? 'graph';
    }
  };
  const saveModuleId = (id: VacpDebugModuleId) => {
    try {
      localStorage.setItem(MODULE_KEY, id);
    } catch {
      // ignore
    }
  };

  let currentModuleId: VacpDebugModuleId = readModuleId();
  let playbooks: VacpPlaybook[] = [];
  let activeBridge: VacpWindowBridge | null = null;
  let unsubscribe: (() => void) | null = null;
  let pendingRender = false;

  const dbg = (message: string) => ({ source: 'debug' as const, message });

  const renderModuleNav = () => {
    moduleList.textContent = '';
    moduleSelect.textContent = '';

    modules.forEach((m) => {
      const label = m.icon ? `${m.icon} ${m.title}` : m.title;

      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = label;
      moduleSelect.append(opt);

      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vacp-debug-ui-module';
      b.textContent = label;
      b.setAttribute('aria-current', m.id === currentModuleId ? 'true' : 'false');
      b.title = m.title;
      b.addEventListener('click', () => {
        currentModuleId = m.id;
        saveModuleId(currentModuleId);
        renderModuleNav();
        requestRender();
      });
      moduleList.append(b);
    });

    moduleSelect.value = currentModuleId;
  };

  moduleSelect.addEventListener('change', () => {
    const next = moduleSelect.value;
    if (!modules.some((m) => m.id === next)) return;
    currentModuleId = next;
    saveModuleId(currentModuleId);
    renderModuleNav();
    requestRender();
  });

  renderModuleNav();

  const updateTitle = (rt: VacpRuntimeSnapshot) => {
    const rid = (rt.runtimeId ?? '').toString().slice(0, 8);
    titleEl.textContent = `VACP Debug (${globalKey}) • mode=${rt.mode} cursor=${rt.cursor} history=${rt.history.length} • runtime=${rid}`;
  };

  const currentModule = (): VacpDebugModule | null => modules.find((m) => m.id === currentModuleId) ?? null;

  const render = async (bridge: VacpWindowBridge) => {
    activeBridge = bridge;
    const runtime = await readRuntime(bridge);
    updateTitle(runtime);

    const mod = currentModule();
    if (!mod) return;

    await mod.render(content, {
      bridge,
      runtime,
      playbooks,
      requestRender,
      setDiagramMermaid: () => {},
    });
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

  const connect = async () => {
    const bridge = getBridge(globalKey);
    if (!bridge) {
      activeBridge = null;
      content.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'vacp-debug-ui-small';
      msg.textContent = `No VACP bridge found.\n\nExpected window.${globalKey} with getCapabilities/getState/execute.\n\nTip: enable VACP in the app and reload.`;
      content.append(msg);
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
    const next = !isPanelVisible(panel);
    setPanelVisible(panel, next);
    if (next) {
      // Keep the debug UI above provider-level portals/tooltips that may
      // re-parent elements into <body> with their own z-index.
      document.body.append(root);
      document.body.append(panel);
      panelPosition();
      void connect();
    }
  });

  closeBtn.addEventListener('click', () => setPanelVisible(panel, false));

  window.addEventListener('resize', () => panelPosition());

  installVacpDebugShortcuts({
    isPanelVisible: () => isPanelVisible(panel),
    setPanelVisible: (v) => setPanelVisible(panel, v),
    moduleIds: modules.map((m) => m.id),
    selectModule: (id) => {
      if (!modules.some((m) => m.id === id)) return;
      currentModuleId = id;
      saveModuleId(id);
      renderModuleNav();
      requestRender();
    },
    refresh: () => void withBridge(async (b) => void (await b.refresh?.(dbg('refresh')))),
  });
}
