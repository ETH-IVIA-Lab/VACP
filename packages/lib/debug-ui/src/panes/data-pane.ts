import type { VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';
import { runDataSql, safeJson } from './data-helpers';
import { buildSelectionPreview, copyToClipboard } from './data-pane-utils';
import { createResultSection } from './data-pane-result';
import { createSqlEditor } from './sql-editor';

export type DataUiState = {
  selectedHandleRef?: string;
  queryText: string;
  maxRows?: number;
  viewMode?: 'table' | 'json';
  lastResultText?: string;
  lastErrorText?: string;
  lastPreviewText?: string;
  lastPreviewAt?: string;
};

export async function renderDataPane(args: {
  container: HTMLElement;
  runtime: VacpRuntimeSnapshot;
  bridge: VacpWindowBridge;
  state: DataUiState;
  onChange: (next: Partial<DataUiState>) => void;
}): Promise<void> {
  const { container, runtime, bridge, state, onChange } = args;
  container.textContent = '';

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'DuckDB (vacp.data_sql)';

  const help = document.createElement('div');
  help.className = 'vacp-debug-ui-small';
  help.textContent = [
    'This view lets you query the currently selected data with SQL (in-browser DuckDB).',
    '',
    '- vacp_all: the full relation for the handle (unfiltered)',
    '- vacp_handle: the current selection (often a filtered subset)',
    '',
    'Tip: if nothing is selected, vacp_handle is typically identical to vacp_all.',
  ].join('\n');

  const handles = (runtime.currentCapabilities.graph.nodes ?? []).filter(
    (n) => (n as any)?.kind === 'DataHandle',
  ) as any[];

  if (!handles.length) {
    container.append(title, help, document.createTextNode('\nNo DataHandle nodes in this graph.\n'));
    return;
  }

  const selected = state.selectedHandleRef ?? String(handles[0]?.ref ?? '');
  const maxRows = state.maxRows ?? 50;
  const viewMode = state.viewMode ?? 'table';

  const handleField = document.createElement('div');
  handleField.className = 'vacp-debug-ui-field';
  const handleLabel = document.createElement('label');
  handleLabel.textContent = 'DataHandle';
  const handleSelect = document.createElement('select');
  handleSelect.title = 'Choose which DataHandle to bind as vacp_all / vacp_handle for queries.';
  handles.forEach((h) => {
    const opt = document.createElement('option');
    opt.value = String(h.ref);
    opt.textContent = h.title ? `${h.title} (${h.ref})` : String(h.ref);
    handleSelect.append(opt);
  });
  handleSelect.value = selected;
  handleSelect.addEventListener('change', () => {
    onChange({ selectedHandleRef: handleSelect.value, lastPreviewAt: undefined, lastPreviewText: undefined });
  });
  handleField.append(handleLabel, handleSelect);

  const previewTitle = document.createElement('div');
  previewTitle.className = 'vacp-debug-ui-section-title';
  previewTitle.textContent = 'Selection preview';

  const previewRow = document.createElement('div');
  previewRow.className = 'vacp-debug-ui-actions';
  const refreshPreviewBtn = document.createElement('button');
  refreshPreviewBtn.type = 'button';
  refreshPreviewBtn.textContent = 'Refresh preview';
  refreshPreviewBtn.title = 'Runs lightweight preview queries against vacp_all and vacp_handle.';
  previewRow.append(refreshPreviewBtn);

  const previewOut = document.createElement('div');
  previewOut.className = 'vacp-debug-ui-small';
  previewOut.textContent = state.lastPreviewText ?? '';

  const queryTitle = document.createElement('div');
  queryTitle.className = 'vacp-debug-ui-section-title';
  queryTitle.textContent = 'Query';

  const queryField = document.createElement('div');
  queryField.className = 'vacp-debug-ui-field';
  const queryLabel = document.createElement('label');
  queryLabel.textContent = 'SQL';
  const editor = createSqlEditor({
    value: state.queryText || 'SELECT COUNT(*)::INTEGER AS n_all FROM vacp_all',
    focusId: 'data-sql',
    title: 'DuckDB SQL. Use vacp_all and vacp_handle as input relations.',
    onInput: (v) => {
      state.queryText = v;
    },
  });
  queryField.append(queryLabel, editor.root);

  const quickRow = document.createElement('div');
  quickRow.className = 'vacp-debug-ui-actions';
  const q1 = document.createElement('button');
  q1.type = 'button';
  q1.textContent = 'Count all';
  q1.title = 'Insert: SELECT COUNT(*) FROM vacp_all';
  const q2 = document.createElement('button');
  q2.type = 'button';
  q2.textContent = 'Count selected';
  q2.title = 'Insert: SELECT COUNT(*) FROM vacp_handle';
  const q3 = document.createElement('button');
  q3.type = 'button';
  q3.textContent = 'Preview rows';
  q3.title = 'Insert: SELECT * FROM vacp_handle LIMIT 20';
  const q4 = document.createElement('button');
  q4.type = 'button';
  q4.textContent = 'Describe';
  q4.title = 'Insert: DESCRIBE vacp_all';
  const q5 = document.createElement('button');
  q5.type = 'button';
  q5.textContent = 'Sample';
  q5.title = 'Insert: SELECT * FROM vacp_handle ORDER BY random() LIMIT 20';

  [q1, q2, q3, q4, q5].forEach((b) =>
    b.addEventListener('click', () => {
      editor.setValue(
        b === q1
          ? 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all'
          : b === q2
            ? 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle'
            : b === q3
              ? 'SELECT * FROM vacp_handle LIMIT 20'
              : b === q4
                ? 'DESCRIBE vacp_all'
                : 'SELECT * FROM vacp_handle ORDER BY random() LIMIT 20',
      );
    }),
  );
  quickRow.append(q1, q2, q3, q4, q5);

  const runRow = document.createElement('div');
  runRow.className = 'vacp-debug-ui-actions';

  const maxRowsField = document.createElement('label');
  maxRowsField.className = 'vacp-debug-ui-inline-label';
  maxRowsField.textContent = 'Max rows';
  const maxRowsInput = document.createElement('input');
  maxRowsInput.type = 'number';
  maxRowsInput.min = '1';
  maxRowsInput.max = '5000';
  maxRowsInput.step = '1';
  maxRowsInput.value = String(maxRows);
  maxRowsInput.title = 'Limits JSON results to keep the debug UI responsive.';
  maxRowsInput.dataset.vacpFocus = 'data-max-rows';
  maxRowsInput.addEventListener('change', () => {
    const next = Number(maxRowsInput.value);
    onChange({ maxRows: Number.isFinite(next) && next > 0 ? Math.floor(next) : 50 });
  });

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.textContent = 'Run query';
  runBtn.title = 'Executes vacp.data_sql for this handle and shows the result (JSON or table).';

  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.textContent = viewMode === 'table' ? 'View: table' : 'View: JSON';
  viewBtn.title = 'Toggle result rendering.';
  viewBtn.setAttribute('aria-pressed', viewMode === 'table' ? 'true' : 'false');

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy result JSON';
  copyBtn.title = 'Copy the last query result JSON to clipboard.';
  copyBtn.disabled = !state.lastResultText;
  runRow.append(maxRowsField, maxRowsInput, runBtn, viewBtn, copyBtn);

  const errorOut = document.createElement('div');
  errorOut.className = 'vacp-debug-ui-small';
  errorOut.textContent = state.lastErrorText ?? '';

  const resultSection = createResultSection({
    maxRows,
    viewMode,
    lastResultText: state.lastResultText,
  });

  const refreshPreview = async () => {
    const preview = await buildSelectionPreview(bridge, { handleRef: selected });
    onChange({ lastPreviewText: preview.text, lastPreviewAt: preview.at });
  };

  refreshPreviewBtn.addEventListener('click', () => void refreshPreview().catch(() => {}));

  const keepSqlFocus = (el: HTMLElement) => {
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => editor.textarea.focus({ preventScroll: true }));
  };
  [refreshPreviewBtn, q1, q2, q3, q4, q5, runBtn, viewBtn, copyBtn].forEach(keepSqlFocus);

  runBtn.addEventListener('click', async () => {
    onChange({ lastErrorText: '' });
    try {
      editor.textarea.focus({ preventScroll: true });
      const sql = editor.getValue().trim();
      if (!sql) return;
      const res = await runDataSql(bridge, { handleRef: selected, sql, maxRows });
      if (!res.ok) {
        onChange({ lastErrorText: (res as any)?.error?.message ?? 'Query failed', lastResultText: '' });
        return;
      }
      const resultText = safeJson(res.result);
      onChange({ lastResultText: resultText, lastErrorText: '' });
    } catch (err) {
      onChange({ lastErrorText: err instanceof Error ? err.message : String(err), lastResultText: '' });
    }
  });

  copyBtn.addEventListener('click', () => {
    if (state.lastResultText) void copyToClipboard(state.lastResultText);
  });

  viewBtn.addEventListener('click', () => {
    onChange({ viewMode: viewMode === 'table' ? 'json' : 'table' });
  });

  container.append(
    title,
    help,
    handleField,
    previewTitle,
    previewRow,
    previewOut,
    queryTitle,
    queryField,
    quickRow,
    runRow,
    errorOut,
    resultSection.title,
    resultSection.meta,
    resultSection.resolvedDetails,
    resultSection.out,
  );

  // If the tab is opened and there is no preview yet for this handle, auto-run
  // the lightweight preview once to keep the pane immediately useful.
  if (!state.lastPreviewAt || !state.lastPreviewText) {
    void refreshPreview().catch(() => {});
  }
}

export function createInitialDataUiState(): DataUiState {
  return {
    queryText: 'SELECT COUNT(*)::INTEGER AS n_all FROM vacp_all',
    maxRows: 50,
    viewMode: 'table',
    lastResultText: '',
    lastErrorText: '',
    lastPreviewText: '',
    lastPreviewAt: undefined,
  };
}
