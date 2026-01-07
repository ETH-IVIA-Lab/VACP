export type VacpDebugUiDom = {
  root: HTMLDivElement;
  button: HTMLButtonElement;

  panel: HTMLDivElement;
  titleEl: HTMLDivElement;

  moduleBar: HTMLDivElement;
  content: HTMLDivElement;

  liveBtn: HTMLButtonElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  observeBtn: HTMLButtonElement;
  refreshBtn: HTMLButtonElement;
  copyBtn: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
};

/**
 * Debug UI shell DOM.
 *
 * The shell is deliberately boring and stable. "Features" live in modules that
 * render into `content` and are selected via `moduleBar`.
 */
export function createVacpDebugUiDom(args: { globalKey: string }): VacpDebugUiDom {
  const root = document.createElement('div');
  root.id = 'vacp-debug-ui-root';
  root.setAttribute('data-vacp-debug-ui', '1');
  root.className = 'vacp-debug-ui-root';

  const button = document.createElement('button');
  button.className = 'vacp-debug-ui-button';
  button.type = 'button';
  button.textContent = 'VACP';
  button.title = 'Open VACP debug tools';

  const panel = document.createElement('div');
  panel.id = 'vacp-debug-ui-panel';
  panel.className = 'vacp-debug-ui-panel';

  const header = document.createElement('header');
  header.className = 'vacp-debug-ui-header';

  const left = document.createElement('div');
  left.className = 'vacp-debug-ui-header-left';

  const titleEl = document.createElement('div');
  titleEl.className = 'vacp-debug-ui-title';
  titleEl.textContent = `VACP Debug (${args.globalKey})`;

  const moduleBar = document.createElement('div');
  moduleBar.className = 'vacp-debug-ui-modulebar';

  left.append(titleEl, moduleBar);

  const right = document.createElement('div');
  right.className = 'vacp-debug-ui-header-actions';

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
  observeBtn.setAttribute('aria-pressed', 'true');

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Capture a fresh snapshot into the runtime timeline';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy diagram';
  copyBtn.title = 'Copy the current diagram Mermaid source to clipboard';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.title = 'Close debug tools';

  right.append(liveBtn, undoBtn, redoBtn, observeBtn, refreshBtn, copyBtn, closeBtn);
  header.append(left, right);

  const content = document.createElement('div');
  content.className = 'vacp-debug-ui-content';

  panel.append(header, content);

  root.append(button);

  return {
    root,
    button,
    panel,
    titleEl,
    moduleBar,
    content,
    liveBtn,
    undoBtn,
    redoBtn,
    observeBtn,
    refreshBtn,
    copyBtn,
    closeBtn,
  };
}
