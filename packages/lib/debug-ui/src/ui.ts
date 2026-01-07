export type VacpDebugUiDom = {
  root: HTMLDivElement;
  button: HTMLButtonElement;

  panel: HTMLDivElement;
  titleEl: HTMLDivElement;

  moduleSelect: HTMLSelectElement;
  moduleList: HTMLDivElement;
  content: HTMLDivElement;

  closeBtn: HTMLButtonElement;
};

/**
 * Debug UI shell DOM.
 *
 * The shell is deliberately boring and stable:
 * - a small floating pill to open/close
 * - a panel with a vertical tool nav + a single focused content area
 *
 * "Features" live in modules that render into `content`.
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
  // Inline background as a last-resort guard against app-level CSS that
  // accidentally overrides our stylesheet.
  panel.style.background = '#0b1020';
  panel.style.color = '#e7e9ee';

  const header = document.createElement('header');
  header.className = 'vacp-debug-ui-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'vacp-debug-ui-title';
  titleEl.textContent = `VACP Debug (${args.globalKey})`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.title = 'Close debug tools (Esc)';

  header.append(titleEl, closeBtn);

  const shell = document.createElement('div');
  shell.className = 'vacp-debug-ui-shell';

  const nav = document.createElement('nav');
  nav.className = 'vacp-debug-ui-nav';

  const moduleSelect = document.createElement('select');
  moduleSelect.className = 'vacp-debug-ui-nav-select';
  moduleSelect.title = 'Select a debug tool';

  const moduleList = document.createElement('div');
  moduleList.className = 'vacp-debug-ui-nav-list';

  nav.append(moduleSelect, moduleList);

  const content = document.createElement('div');
  content.className = 'vacp-debug-ui-content';

  shell.append(nav, content);

  panel.append(header, shell);

  root.append(button);

  return {
    root,
    button,
    panel,
    titleEl,
    moduleSelect,
    moduleList,
    content,
    closeBtn,
  };
}
