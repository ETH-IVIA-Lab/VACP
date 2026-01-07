import type {
  VacpCapabilitiesSnapshot,
  VacpDemo,
  VacpHistoryEntry,
  VacpRuntimeBridge,
  VacpRuntimeSnapshot,
  VacpStateSnapshot,
} from '@vacp/core';
import { VACP_APPLY_STATE_ACTION } from '@vacp/core';
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

type VacpWindowBridge = VacpRuntimeBridge & {
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

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `vacp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
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
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      row-gap: 6px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(231, 233, 238, 0.12);
    }
    .vacp-debug-ui-title {
      flex: 1;
      min-width: 220px;
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      opacity: 0.9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vacp-debug-ui-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .vacp-debug-ui-actions button {
      background: rgba(231, 233, 238, 0.1);
      color: #e7e9ee;
      border: 1px solid rgba(231, 233, 238, 0.18);
      border-radius: 10px;
      padding: 6px 10px;
      cursor: pointer;
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1;
      white-space: nowrap;
    }
    .vacp-debug-ui-actions button[disabled] {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .vacp-debug-ui-actions button:focus-visible,
    .vacp-debug-ui-tab:focus-visible {
      outline: 2px solid rgba(231, 233, 238, 0.35);
      outline-offset: 2px;
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
    .vacp-debug-ui-tabs {
      display: flex;
      gap: 6px;
      padding: 8px 0 10px 0;
      border-bottom: 1px solid rgba(231, 233, 238, 0.12);
      margin-bottom: 10px;
    }
    .vacp-debug-ui-tab {
      background: rgba(231, 233, 238, 0.08);
      color: #e7e9ee;
      border: 1px solid rgba(231, 233, 238, 0.14);
      border-radius: 10px;
      padding: 6px 10px;
      cursor: pointer;
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1;
      white-space: nowrap;
    }
    .vacp-debug-ui-tab[aria-selected="true"] {
      background: rgba(231, 233, 238, 0.18);
      border-color: rgba(231, 233, 238, 0.22);
    }
    .vacp-debug-ui-section-title {
      font: 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.75;
      margin: 10px 0 6px 0;
    }
    .vacp-debug-ui-small {
      font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      opacity: 0.85;
      white-space: pre-wrap;
    }
    .vacp-debug-ui-field {
      display: grid;
      gap: 6px;
      margin: 8px 0;
    }
    .vacp-debug-ui-field label {
      font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      opacity: 0.9;
    }
    .vacp-debug-ui-field textarea,
    .vacp-debug-ui-field select,
    .vacp-debug-ui-field input {
      width: 100%;
      background: rgba(231, 233, 238, 0.08);
      border: 1px solid rgba(231, 233, 238, 0.18);
      color: #e7e9ee;
      border-radius: 10px;
      padding: 8px;
      font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      box-sizing: border-box;
    }
    .vacp-debug-ui-field textarea {
      min-height: 110px;
      resize: vertical;
      white-space: pre;
    }
    .vacp-debug-ui-list {
      display: grid;
      gap: 6px;
    }
    .vacp-debug-ui-row {
      border: 1px solid rgba(231, 233, 238, 0.12);
      border-radius: 10px;
      padding: 8px;
      cursor: pointer;
      background: rgba(231, 233, 238, 0.06);
    }
    .vacp-debug-ui-row:hover {
      background: rgba(231, 233, 238, 0.10);
    }
    .vacp-debug-ui-row[aria-selected="true"] {
      outline: 2px solid rgba(231, 233, 238, 0.25);
    }
  `;
  document.head.append(style);
}

type DebugTab = 'Graph' | 'Actions' | 'History' | 'Demo' | 'JSON';

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-root')) return;

  const globalKey = options?.globalKey ?? '__vacp';
  const direction = options?.direction ?? 'LR';

  ensureStyles();

  const root = document.createElement('div');
  root.id = 'vacp-debug-ui-root';
  root.setAttribute('data-vacp-debug-ui', '1');

  const button = document.createElement('button');
  button.className = 'vacp-debug-ui-button';
  button.type = 'button';
  button.textContent = 'VACP';
  button.title = 'Open VACP debug overlay';

  const panel = document.createElement('div');
  panel.className = 'vacp-debug-ui-panel';

  const header = document.createElement('header');
  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-title';
  title.textContent = `VACP Debug (${globalKey})`;

  const actions = document.createElement('div');
  actions.className = 'vacp-debug-ui-actions';

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
  observeBtn.title =
    'Toggle snapshot polling. Useful when a provider cannot emit human interaction events; the runtime will record a new entry when state changes.';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Capture a fresh snapshot into the runtime timeline (useful after human interaction)';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy Mermaid';
  copyBtn.title = 'Copy the Mermaid source for the current graph to clipboard';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.title = 'Close the overlay (does not remove the VACP runtime)';

  actions.append(liveBtn, undoBtn, redoBtn, observeBtn, refreshBtn, copyBtn, closeBtn);
  header.append(title, actions);

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
        : t === 'Actions'
          ? 'Manually dispatch actions'
          : t === 'History'
            ? 'Inspect runtime timeline entries'
            : t === 'Demo'
              ? 'Step through provider-supplied demo scripts'
              : 'Edit debug overrides and apply to the live app (if supported)';
    tabs.append(b);
  });

  const graphPane = document.createElement('div');
  const actionsPane = document.createElement('div');
  const historyPane = document.createElement('div');
  const demoPane = document.createElement('div');
  const jsonPane = document.createElement('div');

  const panes: Record<DebugTab, HTMLElement> = {
    Graph: graphPane,
    Actions: actionsPane,
    History: historyPane,
    Demo: demoPane,
    JSON: jsonPane,
  };

  codeHost.append(tabs, graphPane, actionsPane, historyPane, demoPane, jsonPane);

  body.append(svgHost, codeHost);
  panel.append(header, body);
  root.append(button, panel);
  document.body.append(root);

  let lastMermaid = '';
  let currentTab: DebugTab = 'Graph';
  let unsubscribe: (() => void) | null = null;
  let observeEnabled = true;
  let demos: VacpDemo[] = [];
  let selectedDemoId: string | null = null;
  let selectedStepIdx = 0;

  async function renderSvg(mermaidText: string): Promise<void> {
    svgHost.textContent = '';
    try {
      const mod = await import('mermaid');
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        flowchart: { htmlLabels: true },
      });
      const id = `vacp_${Math.random().toString(16).slice(2)}`;
      const res = await mermaid.render(id, mermaidText);
      svgHost.innerHTML = res.svg;
    } catch (err) {
      svgHost.textContent = `Mermaid render failed: ${String(err)}`;
    }
  }

  function setTab(next: DebugTab): void {
    currentTab = next;
    (Object.keys(tabButtons) as DebugTab[]).forEach((t) =>
      tabButtons[t].setAttribute('aria-selected', t === next ? 'true' : 'false'),
    );
    (Object.keys(panes) as DebugTab[]).forEach((t) => {
      panes[t].style.display = t === next ? 'block' : 'none';
    });
  }

  async function readRuntime(bridge: VacpWindowBridge): Promise<VacpRuntimeSnapshot> {
    if (typeof bridge.getRuntime === 'function') {
      const rt = await bridge.getRuntime();
      return rt;
    }
    const [capabilities, state] = await Promise.all([bridge.getCapabilities(), bridge.getState()]);
    return {
      version: capabilities.version,
      mode: 'live',
      cursor: -1,
      history: [],
      liveCapabilities: capabilities,
      liveState: state,
      currentCapabilities: capabilities,
      currentState: state,
    };
  }

  async function readDemos(bridge: VacpWindowBridge): Promise<VacpDemo[]> {
    if (typeof bridge.getDemos !== 'function') return [];
    const res = await bridge.getDemos();
    return Array.isArray(res) ? res : [];
  }

  function renderHistory(runtime: VacpRuntimeSnapshot, bridge: VacpWindowBridge): void {
    historyPane.textContent = '';
    const title = document.createElement('div');
    title.className = 'vacp-debug-ui-section-title';
    title.textContent = 'Timeline';

    const list = document.createElement('div');
    list.className = 'vacp-debug-ui-list';

    const selectedCursor = runtime.cursor;
    runtime.history.forEach((e, idx) => {
      const row = document.createElement('div');
      row.className = 'vacp-debug-ui-row';
      row.setAttribute('aria-selected', idx === selectedCursor && runtime.mode === 'inspect' ? 'true' : 'false');
      const label = [
        `${idx}`,
        e.kind,
        e.source,
        e.call?.name ? `action=${e.call.name}` : '',
        e.message ? `msg=${e.message}` : '',
      ]
        .filter(Boolean)
        .join(' • ');
      row.textContent = label;
      row.addEventListener('click', () => {
        if (typeof bridge.setCursor === 'function') bridge.setCursor(idx, { source: 'debug', message: 'inspect' });
      });
      list.append(row);
    });

    const hint = document.createElement('div');
    hint.className = 'vacp-debug-ui-small';
    hint.textContent =
      'Tip: timeline entries are captured on agent actions (execute), explicit refresh, and provider-driven human changes (if supported).';

    const detailsTitle = document.createElement('div');
    detailsTitle.className = 'vacp-debug-ui-section-title';
    detailsTitle.textContent = 'Selected entry';

    const details = document.createElement('div');
    details.className = 'vacp-debug-ui-small';
    const idx = runtime.mode === 'inspect' ? runtime.cursor : runtime.history.length - 1;
    const selected = idx >= 0 ? runtime.history[idx] : null;
    details.textContent = selected ? JSON.stringify(selected, null, 2) : '(no history yet)';

    historyPane.append(title, list, hint, detailsTitle, details);
  }

  function renderActions(runtime: VacpRuntimeSnapshot, bridge: VacpWindowBridge): void {
    actionsPane.textContent = '';
    const title = document.createElement('div');
    title.className = 'vacp-debug-ui-section-title';
    title.textContent = 'Dispatch Action';

    const actions = runtime.currentCapabilities.graph.actions ?? [];
    const selectField = document.createElement('div');
    selectField.className = 'vacp-debug-ui-field';
    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'Action';
    const select = document.createElement('select');
    select.title = 'Pick an action registered by the provider (or choose custom to test errors)';
    const customName = '__custom__';
    const knownActions = actions.slice();
    if (knownActions.length) {
      knownActions.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        select.append(opt);
      });
    }
    const customOpt = document.createElement('option');
    customOpt.value = customName;
    customOpt.textContent = '(custom action name)';
    select.append(customOpt);
    selectField.append(selectLabel, select);

    const customField = document.createElement('div');
    customField.className = 'vacp-debug-ui-field';
    const customLabel = document.createElement('label');
    customLabel.textContent = 'Custom action name';
    const customInput = document.createElement('input');
    customInput.value = '';
    customInput.title = 'Exact action name to call when using “(custom action name)”';
    customField.append(customLabel, customInput);

    const metaTitle = document.createElement('div');
    metaTitle.className = 'vacp-debug-ui-section-title';
    metaTitle.textContent = 'Dispatch metadata';

    const sourceField = document.createElement('div');
    sourceField.className = 'vacp-debug-ui-field';
    const sourceLabel = document.createElement('label');
    sourceLabel.textContent = 'Source';
    const sourceSelect = document.createElement('select');
    (['debug', 'agent', 'human', 'system'] as const).forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sourceSelect.append(opt);
    });
    sourceSelect.title =
      'Label the call source in the local runtime timeline. Use “debug” for manual testing; “agent” is typical for MCP.';
    sourceField.append(sourceLabel, sourceSelect);

    const messageField = document.createElement('div');
    messageField.className = 'vacp-debug-ui-field';
    const messageLabel = document.createElement('label');
    messageLabel.textContent = 'Message (optional)';
    const messageInput = document.createElement('input');
    messageInput.value = 'manual dispatch';
    messageInput.title = 'Short note recorded into the runtime timeline entry (optional)';
    messageField.append(messageLabel, messageInput);

    const schemaTitle = document.createElement('div');
    schemaTitle.className = 'vacp-debug-ui-section-title';
    schemaTitle.textContent = 'Parameters schema';
    const schemaPre = document.createElement('div');
    schemaPre.className = 'vacp-debug-ui-small';

    const paramsField = document.createElement('div');
    paramsField.className = 'vacp-debug-ui-field';
    const paramsLabel = document.createElement('label');
    paramsLabel.textContent = 'Params (JSON)';
    const params = document.createElement('textarea');
    params.value = '{}';
    params.title = 'JSON object passed as action params. Must match the action schema.';
    paramsField.append(paramsLabel, params);

    const run = document.createElement('button');
    run.type = 'button';
    run.textContent = 'Execute';
    run.title =
      'Execute the selected action. Uses bridge.dispatch() when available so the timeline records the chosen source/message.';

    const resultTitle = document.createElement('div');
    resultTitle.className = 'vacp-debug-ui-section-title';
    resultTitle.textContent = 'Result';
    const resultPre = document.createElement('div');
    resultPre.className = 'vacp-debug-ui-small';
    resultPre.textContent = '(not executed yet)';

    function updateActionUi(): void {
      const sel = select.value;
      customField.style.display = sel === customName ? 'block' : 'none';
      const a = knownActions.find((x) => x.name === sel);
      schemaPre.textContent = a ? JSON.stringify(a.parameters ?? {}, null, 2) : '(no schema available)';
    }
    select.addEventListener('change', () => updateActionUi());
    updateActionUi();

    run.addEventListener('click', async () => {
      try {
        run.disabled = true;
        const selected = select.value;
        const name = selected === customName ? customInput.value.trim() : selected;
        if (!name) throw new Error('Action name is required');
        const parsed = params.value.trim() ? (JSON.parse(params.value) as unknown) : undefined;
        const call = { callId: makeId(), name, params: parsed };
        const source = sourceSelect.value as 'debug' | 'agent' | 'human' | 'system';
        const message = messageInput.value.trim();
        const res =
          typeof bridge.dispatch === 'function'
            ? await bridge.dispatch(call, { source, message: message || undefined })
            : await bridge.execute(call);
        resultPre.textContent = JSON.stringify(res, null, 2);
        if (typeof bridge.refresh === 'function') await bridge.refresh({ source: 'debug', message: `after ${name}` });
      } catch (err) {
        resultPre.textContent = `Execute failed: ${String(err)}`;
      } finally {
        run.disabled = false;
      }
    });

    const emptyHint = document.createElement('div');
    emptyHint.className = 'vacp-debug-ui-small';
    emptyHint.textContent = actions.length
      ? 'Pick a registered action, or enter a custom action name to test error paths and timeline behavior.'
      : 'No actions registered: enter a custom action name to test the dispatch pipeline and timeline.';

    actionsPane.append(
      title,
      emptyHint,
      selectField,
      customField,
      metaTitle,
      sourceField,
      messageField,
      schemaTitle,
      schemaPre,
      paramsField,
      run,
      resultTitle,
      resultPre,
    );
  }

  function renderDemo(bridge: VacpWindowBridge): void {
    demoPane.textContent = '';

    const title = document.createElement('div');
    title.className = 'vacp-debug-ui-section-title';
    title.textContent = 'Demo Stepper';

    const hint = document.createElement('div');
    hint.className = 'vacp-debug-ui-small';
    hint.textContent =
      'Demos are optional scripts provided by the app. Step through them to see how actions mutate state and show up in history.';

    if (!demos.length) {
      const empty = document.createElement('div');
      empty.className = 'vacp-debug-ui-small';
      empty.textContent = 'No demos provided by the current bridge.';
      demoPane.append(title, hint, empty);
      return;
    }

    const selectField = document.createElement('div');
    selectField.className = 'vacp-debug-ui-field';
    const selectLabel = document.createElement('label');
    selectLabel.textContent = 'Demo';
    const select = document.createElement('select');
    select.title = 'Choose which demo script to run/step through';
    demos.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.title;
      select.append(opt);
    });
    selectField.append(selectLabel, select);

    const current = demos.find((d) => d.id === (selectedDemoId ?? demos[0]!.id)) ?? demos[0]!;
    select.value = current.id;
    selectedDemoId = current.id;

    const desc = document.createElement('div');
    desc.className = 'vacp-debug-ui-small';
    desc.textContent = current.description ?? '';

    const controls = document.createElement('div');
    controls.className = 'vacp-debug-ui-actions';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = 'Prev';
    prev.title = 'Move to the previous demo step (does not execute)';

    const run = document.createElement('button');
    run.type = 'button';
    run.textContent = 'Run step';
    run.title = 'Execute the currently selected step action (if any)';

    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = 'Next';
    next.title = 'Move to the next demo step (does not execute)';

    const runAll = document.createElement('button');
    runAll.type = 'button';
    runAll.textContent = 'Run all';
    runAll.title = 'Execute all remaining steps from the current position';

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.title = 'Jump back to step 0 (does not execute)';

    controls.append(prev, run, next, runAll, reset);

    const stepsTitle = document.createElement('div');
    stepsTitle.className = 'vacp-debug-ui-section-title';
    stepsTitle.textContent = `Steps (${current.steps.length})`;

    const list = document.createElement('div');
    list.className = 'vacp-debug-ui-list';

    const clampedIdx = Math.max(0, Math.min(selectedStepIdx, Math.max(0, current.steps.length - 1)));
    selectedStepIdx = clampedIdx;

    current.steps.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'vacp-debug-ui-row';
      row.setAttribute('aria-selected', idx === selectedStepIdx ? 'true' : 'false');
      row.title = 'Click to select this step (does not execute)';
      row.textContent = `${idx}. ${s.title}${s.call ? ` • ${s.call.name}` : ''}`;
      row.addEventListener('click', () => {
        selectedStepIdx = idx;
        renderDemo(bridge);
      });
      list.append(row);
    });

    const stepDetails = document.createElement('div');
    stepDetails.className = 'vacp-debug-ui-small';
    const step = current.steps[selectedStepIdx];
    stepDetails.textContent = step
      ? `${step.description ? `${step.description}\n\n` : ''}${step.call ? JSON.stringify(step.call, null, 2) : '(informational step)'}`
      : '';

    const runStep = async (idx: number) => {
      const s = current.steps[idx];
      if (!s?.call) return;
      const call = { callId: makeId(), name: s.call.name, params: s.call.params };
      const message = `demo:${current.id} step:${idx} ${s.title}`;
      if (typeof bridge.dispatch === 'function') await bridge.dispatch(call, { source: 'debug', message });
      else await bridge.execute(call);
    };

    select.addEventListener('change', () => {
      selectedDemoId = select.value;
      selectedStepIdx = 0;
      renderDemo(bridge);
    });

    prev.addEventListener('click', () => {
      selectedStepIdx = Math.max(0, selectedStepIdx - 1);
      renderDemo(bridge);
    });

    next.addEventListener('click', () => {
      selectedStepIdx = Math.min(current.steps.length - 1, selectedStepIdx + 1);
      renderDemo(bridge);
    });

    reset.addEventListener('click', () => {
      selectedStepIdx = 0;
      renderDemo(bridge);
    });

    run.addEventListener('click', async () => {
      try {
        run.disabled = true;
        await runStep(selectedStepIdx);
        if (typeof bridge.refresh === 'function') await bridge.refresh({ source: 'debug', message: 'after demo step' });
        selectedStepIdx = Math.min(current.steps.length - 1, selectedStepIdx + 1);
      } finally {
        run.disabled = false;
      }
      void refresh();
    });

    runAll.addEventListener('click', async () => {
      try {
        runAll.disabled = true;
        for (let i = selectedStepIdx; i < current.steps.length; i++) {
          await runStep(i);
        }
        if (typeof bridge.refresh === 'function')
          await bridge.refresh({ source: 'debug', message: 'after demo run all' });
        selectedStepIdx = current.steps.length - 1;
      } finally {
        runAll.disabled = false;
      }
      void refresh();
    });

    demoPane.append(title, hint, selectField, desc, controls, stepsTitle, list, stepDetails);
  }

  function renderJson(runtime: VacpRuntimeSnapshot, bridge: VacpWindowBridge): void {
    jsonPane.textContent = '';

    const title = document.createElement('div');
    title.className = 'vacp-debug-ui-section-title';
    title.textContent = 'Inspection Overrides (debug only)';

    const hint = document.createElement('div');
    hint.className = 'vacp-debug-ui-small';
    hint.textContent =
      'These overrides do not mutate the live app. They only affect what the debug UI shows (diagram/state) while in inspect mode.';

    const stateField = document.createElement('div');
    stateField.className = 'vacp-debug-ui-field';
    const stateLabel = document.createElement('label');
    stateLabel.textContent = 'State override (JSON object keyed by vacp:// refs)';
    const stateArea = document.createElement('textarea');
    stateArea.value = JSON.stringify(runtime.currentState.state ?? {}, null, 2);
    stateField.append(stateLabel, stateArea);

    const graphField = document.createElement('div');
    graphField.className = 'vacp-debug-ui-field';
    const graphLabel = document.createElement('label');
    graphLabel.textContent = 'Graph override (VacpGraph JSON)';
    const graphArea = document.createElement('textarea');
    graphArea.value = JSON.stringify(runtime.currentCapabilities.graph ?? {}, null, 2);
    graphField.append(graphLabel, graphArea);

    const applyState = document.createElement('button');
    applyState.type = 'button';
    applyState.textContent = 'Apply state override';
    applyState.title = 'Inspection-only: changes what the debug UI shows (does not mutate the live app)';

    const applyGraph = document.createElement('button');
    applyGraph.type = 'button';
    applyGraph.textContent = 'Apply graph override';
    applyGraph.title = 'Inspection-only: changes what the debug UI shows (does not mutate the live app)';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear overrides';
    clear.title = 'Clear inspection overrides and return to showing live snapshots';

    const liveTitle = document.createElement('div');
    liveTitle.className = 'vacp-debug-ui-section-title';
    liveTitle.textContent = 'Apply To Live App (vacp.apply_state)';

    const liveHint = document.createElement('div');
    liveHint.className = 'vacp-debug-ui-small';
    liveHint.textContent =
      'If the provider exposes `vacp.apply_state`, you can apply the edited state JSON to the live app. This is powerful; use it for local development and debugging.';

    const applyLiveState = document.createElement('button');
    applyLiveState.type = 'button';
    applyLiveState.textContent = 'Apply state to live app';
    applyLiveState.title =
      'Calls vacp.apply_state. Providers interpret the JSON map and apply it to the live app (best-effort).';

    const liveResult = document.createElement('div');
    liveResult.className = 'vacp-debug-ui-small';
    liveResult.textContent = '';

    const note = document.createElement('div');
    note.className = 'vacp-debug-ui-small';
    note.textContent = '';

    applyState.addEventListener('click', () => {
      try {
        if (typeof bridge.setStateOverride !== 'function') throw new Error('Bridge does not support state overrides');
        const parsed = JSON.parse(stateArea.value) as Record<string, unknown>;
        bridge.setStateOverride(parsed as unknown as Record<string, any>, {
          source: 'debug',
          message: 'state override',
        });
        if (typeof bridge.setMode === 'function') bridge.setMode('inspect', { source: 'debug', message: 'inspect' });
        note.textContent = 'State override applied.';
      } catch (err) {
        note.textContent = `Failed: ${String(err)}`;
      }
    });

    applyGraph.addEventListener('click', () => {
      try {
        if (typeof bridge.setGraphOverride !== 'function') throw new Error('Bridge does not support graph overrides');
        const parsed = JSON.parse(graphArea.value) as unknown as any;
        bridge.setGraphOverride(parsed, { source: 'debug', message: 'graph override' });
        if (typeof bridge.setMode === 'function') bridge.setMode('inspect', { source: 'debug', message: 'inspect' });
        note.textContent = 'Graph override applied.';
      } catch (err) {
        note.textContent = `Failed: ${String(err)}`;
      }
    });

    clear.addEventListener('click', () => {
      if (typeof bridge.clearOverrides === 'function') bridge.clearOverrides({ source: 'debug', message: 'clear' });
      note.textContent = 'Overrides cleared.';
    });

    const supportsLiveApply =
      (runtime.currentCapabilities.graph.actions ?? []).some((a) => a.name === VACP_APPLY_STATE_ACTION) &&
      (typeof bridge.dispatch === 'function' || typeof bridge.execute === 'function');
    applyLiveState.disabled = !supportsLiveApply;
    if (!supportsLiveApply) {
      applyLiveState.textContent = 'Apply state to live app (not supported)';
    }

    applyLiveState.addEventListener('click', async () => {
      try {
        applyLiveState.disabled = true;
        const parsed = JSON.parse(stateArea.value) as Record<string, unknown>;
        const call = { callId: makeId(), name: VACP_APPLY_STATE_ACTION, params: { state: parsed } };
        const res =
          typeof bridge.dispatch === 'function'
            ? await bridge.dispatch(call, { source: 'debug', message: 'apply live state' })
            : await bridge.execute(call);
        liveResult.textContent = `Result:\n${JSON.stringify(res, null, 2)}`;
        if (typeof bridge.refresh === 'function')
          await bridge.refresh({ source: 'debug', message: 'after live apply' });
      } catch (err) {
        liveResult.textContent = `Failed: ${String(err)}`;
      } finally {
        applyLiveState.disabled = !supportsLiveApply;
      }
    });

    jsonPane.append(
      title,
      hint,
      stateField,
      applyState,
      graphField,
      applyGraph,
      clear,
      note,
      liveTitle,
      liveHint,
      applyLiveState,
      liveResult,
    );
  }

  function renderGraphText(runtime: VacpRuntimeSnapshot): void {
    graphPane.textContent = '';
    const summary = document.createElement('div');
    summary.className = 'vacp-debug-ui-small';
    summary.textContent = `mode=${runtime.mode} cursor=${runtime.cursor} history=${runtime.history.length}`;
    const pre = document.createElement('div');
    pre.className = 'vacp-debug-ui-small';
    pre.textContent = `\n${lastMermaid}`;
    graphPane.append(summary, pre);
  }

  async function refresh(): Promise<void> {
    const bridge = getBridge(globalKey);
    if (!bridge) {
      graphPane.textContent = `No bridge found at window.${globalKey}.`;
      svgHost.textContent = '';
      return;
    }
    try {
      const runtime = await readRuntime(bridge);
      demos = await readDemos(bridge);
      title.textContent = `VACP Debug (${globalKey}) • mode=${runtime.mode} cursor=${runtime.cursor} history=${runtime.history.length}${
        runtime.runtimeId ? ` • runtime=${runtime.runtimeId.slice(0, 8)}` : ''
      }`;

      liveBtn.disabled = typeof bridge.setMode !== 'function';
      undoBtn.disabled = typeof bridge.undo !== 'function' || runtime.history.length === 0;
      redoBtn.disabled = typeof bridge.redo !== 'function' || runtime.history.length === 0;
      observeBtn.disabled = typeof bridge.startObserving !== 'function' || typeof bridge.stopObserving !== 'function';
      observeBtn.textContent = `Observe: ${observeEnabled ? 'on' : 'off'}`;

      const diagram = renderVacpDiagramMermaid({
        capabilities: runtime.currentCapabilities,
        state: runtime.currentState,
        options: {
          direction,
          includeActions: options?.includeActions ?? true,
          includeStatePreview: options?.includeStatePreview ?? true,
        },
      });
      lastMermaid = diagram;
      renderGraphText(runtime);
      renderActions(runtime, bridge);
      renderHistory(runtime, bridge);
      renderDemo(bridge);
      renderJson(runtime, bridge);
      await renderSvg(diagram);
    } catch (err) {
      graphPane.textContent = `Failed to read VACP state: ${String(err)}`;
      svgHost.textContent = '';
    }
  }

  function open(): void {
    panel.style.display = 'block';
    attachSubscription();
    void refresh();
  }

  function close(): void {
    panel.style.display = 'none';
  }

  function attachSubscription(): void {
    const bridge = getBridge(globalKey);
    if (!bridge) return;
    unsubscribe?.();
    unsubscribe = null;
    if (typeof bridge.subscribe === 'function') {
      unsubscribe = bridge.subscribe((_e: VacpHistoryEntry) => void refresh());
    }
  }

  button.addEventListener('click', () => {
    if (panel.style.display === 'block') close();
    else open();
  });
  closeBtn.addEventListener('click', () => close());
  refreshBtn.addEventListener('click', async () => {
    const bridge = getBridge(globalKey);
    if (bridge && typeof bridge.refresh === 'function')
      await bridge.refresh({ source: 'debug', message: 'manual refresh' });
    void refresh();
  });
  liveBtn.addEventListener('click', () => {
    const bridge = getBridge(globalKey);
    if (bridge && typeof bridge.setMode === 'function') bridge.setMode('live', { source: 'debug', message: 'live' });
    void refresh();
  });
  undoBtn.addEventListener('click', () => {
    const bridge = getBridge(globalKey);
    if (bridge && typeof bridge.undo === 'function') bridge.undo({ source: 'debug', message: 'undo' });
    void refresh();
  });
  redoBtn.addEventListener('click', () => {
    const bridge = getBridge(globalKey);
    if (bridge && typeof bridge.redo === 'function') bridge.redo({ source: 'debug', message: 'redo' });
    void refresh();
  });
  observeBtn.addEventListener('click', () => {
    const bridge = getBridge(globalKey);
    if (!bridge) return;
    if (typeof bridge.startObserving !== 'function' || typeof bridge.stopObserving !== 'function') return;
    observeEnabled = !observeEnabled;
    if (observeEnabled) bridge.startObserving({ source: 'debug', message: 'observe' });
    else bridge.stopObserving();
    void refresh();
  });
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

  (Object.keys(tabButtons) as DebugTab[]).forEach((t) => tabButtons[t].addEventListener('click', () => setTab(t)));
  setTab(currentTab);
  attachSubscription();

  // Best-effort: keep it unobtrusive unless explicitly opened.
}
