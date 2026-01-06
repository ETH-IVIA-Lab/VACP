import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';

/**
 * Debug UI overlay (project concepts).
 *
 * VACP is meant to be *inspectable* during development. A page overlay makes it
 * cheap to answer:
 * - "did this view actually install a bridge?"
 * - "what nodes/actions exist right now?"
 * - "how did the graph change after an interaction?"
 *
 * The overlay is optional and app-agnostic: it only relies on `window.__vacp`.
 * It dynamically imports Mermaid to render the current graph to SVG on demand.
 */

export type VacpDebugUiEnabled = boolean | 'auto';

export interface VacpDebugUiOptions {
  /**
   * If `true`, always show the overlay.
   * If `false`, never show it.
   * If `'auto'`, enable when `?vacpDebug=1` is present or localStorage has
   * `vacp:debug=1`.
   */
  enabled?: VacpDebugUiEnabled;
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  /** Default diagram direction. */
  direction?: 'LR' | 'TB';
  includeActions?: boolean;
  includeStatePreview?: boolean;
}

type VacpWindowBridge = {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  getState: () => Promise<VacpStateSnapshot>;
};

function shouldEnable(enabled: VacpDebugUiEnabled | undefined): boolean {
  if (enabled === true) return true;
  if (enabled === false) return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get('vacpDebug') === '1') return true;
  try {
    if (localStorage.getItem('vacp:debug') === '1') return true;
  } catch {
    // ignore
  }
  return false;
}

function getBridge(globalKey: string): VacpWindowBridge | null {
  const root = globalThis as unknown as Record<string, unknown>;
  const b = root[globalKey];
  if (!b || typeof b !== 'object') return null;
  const maybe = b as Partial<VacpWindowBridge>;
  if (typeof maybe.getCapabilities !== 'function' || typeof maybe.getState !== 'function') return null;
  return maybe as VacpWindowBridge;
}

function ensureStyles(): void {
  if (document.getElementById('vacp-debug-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'vacp-debug-ui-style';
  style.textContent = `
    .vacp-debug-ui-button {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483647;
      background: #0b1020;
      color: #e7e9ee;
      border: 1px solid rgba(231, 233, 238, 0.2);
      border-radius: 999px;
      padding: 8px 12px;
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }
    .vacp-debug-ui-panel {
      position: fixed;
      right: 14px;
      bottom: 56px;
      width: min(860px, calc(100vw - 28px));
      height: min(680px, calc(100vh - 92px));
      z-index: 2147483647;
      background: #0b1020;
      color: #e7e9ee;
      border: 1px solid rgba(231, 233, 238, 0.2);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
      display: none;
    }
    .vacp-debug-ui-panel header {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(231, 233, 238, 0.12);
    }
    .vacp-debug-ui-title {
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      opacity: 0.9;
    }
    .vacp-debug-ui-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .vacp-debug-ui-actions button {
      background: rgba(231, 233, 238, 0.1);
      color: #e7e9ee;
      border: 1px solid rgba(231, 233, 238, 0.18);
      border-radius: 8px;
      padding: 6px 8px;
      cursor: pointer;
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .vacp-debug-ui-body {
      display: grid;
      grid-template-columns: 1fr 340px;
      height: calc(100% - 45px);
    }
    .vacp-debug-ui-svg {
      padding: 10px;
      overflow: auto;
      background: #0b1020;
    }
    .vacp-debug-ui-svg svg {
      background: white;
      border-radius: 8px;
      padding: 10px;
      max-width: 100%;
      height: auto;
    }
    .vacp-debug-ui-code {
      border-left: 1px solid rgba(231, 233, 238, 0.12);
      padding: 10px;
      overflow: auto;
      font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      white-space: pre;
      color: #e7e9ee;
    }
  `;
  document.head.append(style);
}

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-root')) return;

  const globalKey = options?.globalKey ?? '__vacp';
  const direction = options?.direction ?? 'LR';

  ensureStyles();

  const root = document.createElement('div');
  root.id = 'vacp-debug-ui-root';

  const button = document.createElement('button');
  button.className = 'vacp-debug-ui-button';
  button.type = 'button';
  button.textContent = 'VACP';

  const panel = document.createElement('div');
  panel.className = 'vacp-debug-ui-panel';

  const header = document.createElement('header');
  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-title';
  title.textContent = `VACP Debug (${globalKey})`;

  const actions = document.createElement('div');
  actions.className = 'vacp-debug-ui-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy Mermaid';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';

  actions.append(refreshBtn, copyBtn, closeBtn);
  header.append(title, actions);

  const body = document.createElement('div');
  body.className = 'vacp-debug-ui-body';

  const svgHost = document.createElement('div');
  svgHost.className = 'vacp-debug-ui-svg';

  const codeHost = document.createElement('div');
  codeHost.className = 'vacp-debug-ui-code';
  codeHost.textContent = '(loading…)';

  body.append(svgHost, codeHost);
  panel.append(header, body);
  root.append(button, panel);
  document.body.append(root);

  let lastMermaid = '';

  async function renderSvg(mermaidText: string): Promise<void> {
    svgHost.textContent = '';
    try {
      const mod = await import('mermaid');
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      const id = `vacp_${Math.random().toString(16).slice(2)}`;
      const res = await mermaid.render(id, mermaidText);
      svgHost.innerHTML = res.svg;
    } catch (err) {
      svgHost.textContent = `Mermaid render failed: ${String(err)}`;
    }
  }

  async function refresh(): Promise<void> {
    const bridge = getBridge(globalKey);
    if (!bridge) {
      codeHost.textContent = `No bridge found at window.${globalKey}.`;
      svgHost.textContent = '';
      return;
    }
    try {
      const [capabilities, state] = await Promise.all([bridge.getCapabilities(), bridge.getState()]);
      const diagram = renderVacpDiagramMermaid({
        capabilities,
        state,
        options: {
          direction,
          includeActions: options?.includeActions ?? true,
          includeStatePreview: options?.includeStatePreview ?? true,
        },
      });
      lastMermaid = diagram;
      codeHost.textContent = diagram;
      await renderSvg(diagram);
    } catch (err) {
      codeHost.textContent = `Failed to read VACP state: ${String(err)}`;
      svgHost.textContent = '';
    }
  }

  function open(): void {
    panel.style.display = 'block';
    void refresh();
  }

  function close(): void {
    panel.style.display = 'none';
  }

  button.addEventListener('click', () => {
    if (panel.style.display === 'block') close();
    else open();
  });
  closeBtn.addEventListener('click', () => close());
  refreshBtn.addEventListener('click', () => void refresh());
  copyBtn.addEventListener('click', async () => {
    if (!lastMermaid) return;
    try {
      await navigator.clipboard.writeText(lastMermaid);
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Mermaid';
      }, 800);
    } catch {
      // ignore
    }
  });

  // Best-effort: keep it unobtrusive unless explicitly opened.
}
