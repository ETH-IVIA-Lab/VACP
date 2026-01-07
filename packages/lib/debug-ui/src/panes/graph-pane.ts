export type GraphUiState = {
  direction: 'LR' | 'TB';
  includeActions: boolean;
  includeStatePreview: boolean;
};

export function renderGraphPane(args: {
  container: HTMLElement;
  mermaid: string;
  state: GraphUiState;
  onChange: (next: Partial<GraphUiState>) => void;
}): void {
  const { container, mermaid, state, onChange } = args;
  container.textContent = '';

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Mermaid';

  const optionsTitle = document.createElement('div');
  optionsTitle.className = 'vacp-debug-ui-section-title';
  optionsTitle.textContent = 'Options';

  const row = document.createElement('div');
  row.className = 'vacp-debug-ui-actions';

  const dirBtn = document.createElement('button');
  dirBtn.type = 'button';
  dirBtn.textContent = state.direction === 'LR' ? 'Direction: LR' : 'Direction: TB';
  dirBtn.title = 'Toggle diagram direction (left-to-right vs top-to-bottom)';

  const actionsBtn = document.createElement('button');
  actionsBtn.type = 'button';
  actionsBtn.textContent = state.includeActions ? 'Actions: on' : 'Actions: off';
  actionsBtn.title = 'Include action nodes in the diagram';
  actionsBtn.setAttribute('aria-pressed', state.includeActions ? 'true' : 'false');

  const stateBtn = document.createElement('button');
  stateBtn.type = 'button';
  stateBtn.textContent = state.includeStatePreview ? 'State preview: on' : 'State preview: off';
  stateBtn.title = 'Include a small state preview in node labels (useful when debugging selections/params)';
  stateBtn.setAttribute('aria-pressed', state.includeStatePreview ? 'true' : 'false');

  dirBtn.addEventListener('click', () => onChange({ direction: state.direction === 'LR' ? 'TB' : 'LR' }));
  actionsBtn.addEventListener('click', () => onChange({ includeActions: !state.includeActions }));
  stateBtn.addEventListener('click', () => onChange({ includeStatePreview: !state.includeStatePreview }));

  row.append(dirBtn, actionsBtn, stateBtn);

  const code = document.createElement('div');
  code.className = 'vacp-debug-ui-small';
  code.textContent = mermaid;

  container.append(title, optionsTitle, row, code);
}
