import type { DebugTab } from './types';

export type VacpDebugUiDom = {
  root: HTMLDivElement;
  button: HTMLButtonElement;
  panel: HTMLDivElement;
  titleEl: HTMLDivElement;

  layoutBtn: HTMLButtonElement;
  liveBtn: HTMLButtonElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  observeBtn: HTMLButtonElement;
  refreshBtn: HTMLButtonElement;
  copyBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;

  svgHost: HTMLDivElement;
  tabButtons: Record<DebugTab, HTMLButtonElement>;
  panes: Record<DebugTab, HTMLDivElement>;
};

export function createVacpDebugUiDom(args: { globalKey: string }): VacpDebugUiDom {
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
  titleEl.textContent = `VACP Debug (${args.globalKey})`;

  const actionsEl = document.createElement('div');
  actionsEl.className = 'vacp-debug-ui-header-actions';

  const layoutBtn = document.createElement('button');
  layoutBtn.type = 'button';
  layoutBtn.textContent = 'Layout: split';
  layoutBtn.title = 'Cycle overlay layout (diagram + inspector / inspector only / diagram only)';

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

  actionsEl.append(layoutBtn, liveBtn, undoBtn, redoBtn, observeBtn, refreshBtn, copyBtn, closeBtn);
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
    Playbook: document.createElement('button'),
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
              : t === 'Playbook'
                ? 'Step through provider-supplied playbooks (scripted action sequences)'
                : 'Override/apply state (inspect vs live)';
    tabs.append(b);
  });

  const panes: Record<DebugTab, HTMLDivElement> = {
    Graph: document.createElement('div'),
    Data: document.createElement('div'),
    Actions: document.createElement('div'),
    History: document.createElement('div'),
    Playbook: document.createElement('div'),
    JSON: document.createElement('div'),
  };
  (Object.keys(panes) as DebugTab[]).forEach((t) => {
    panes[t].style.display = 'none';
  });

  codeHost.append(tabs, panes.Graph, panes.Data, panes.Actions, panes.History, panes.Playbook, panes.JSON);
  body.append(svgHost, codeHost);
  panel.append(header, body);
  root.append(button, panel);

  return {
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
    svgHost,
    tabButtons,
    panes,
  };
}
