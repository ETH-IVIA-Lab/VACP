import type { VacpActionResult, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';
import { isDataSqlResult, renderResultTable, runDataSql, safeJson } from './data-helpers';

type DataUiState = {
  selectedHandleRef?: string;
  queryText: string;
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
  help.textContent =
    'Pick a DataHandle, then run SQL against two temporary views: vacp_all (all rows) and vacp_handle (current selection).';

  const handles = (runtime.currentCapabilities.graph.nodes ?? []).filter(
    (n) => (n as any)?.kind === 'DataHandle',
  ) as any[];

  if (!handles.length) {
    container.append(title, help, document.createTextNode('\nNo DataHandle nodes in this graph.\n'));
    return;
  }

  const selected = state.selectedHandleRef ?? String(handles[0]?.ref ?? '');

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
  const textarea = document.createElement('textarea');
  textarea.value = state.queryText || 'SELECT COUNT(*)::INTEGER AS n_all FROM vacp_all';
  textarea.title = 'SQL can reference vacp_all and vacp_handle (DuckDB SQL).';
  textarea.addEventListener('input', () => onChange({ queryText: textarea.value }));
  queryField.append(queryLabel, textarea);

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
  [q1, q2, q3].forEach((b) =>
    b.addEventListener('click', () => {
      textarea.value =
        b === q1
          ? 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all'
          : b === q2
            ? 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle'
            : 'SELECT * FROM vacp_handle LIMIT 20';
      onChange({ queryText: textarea.value });
    }),
  );
  quickRow.append(q1, q2, q3);

  const runRow = document.createElement('div');
  runRow.className = 'vacp-debug-ui-actions';
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.textContent = 'Run query';
  runBtn.title = 'Executes vacp.data_sql for this handle and shows the result (JSON or table).';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy result';
  copyBtn.title = 'Copy the last query result JSON to clipboard.';
  copyBtn.disabled = !state.lastResultText;
  runRow.append(runBtn, copyBtn);

  const errorOut = document.createElement('div');
  errorOut.className = 'vacp-debug-ui-small';
  errorOut.textContent = state.lastErrorText ?? '';

  const resultTitle = document.createElement('div');
  resultTitle.className = 'vacp-debug-ui-section-title';
  resultTitle.textContent = 'Result';

  const resultOut = document.createElement('div');
  resultOut.className = 'vacp-debug-ui-table-wrap';

  if (state.lastResultText) {
    try {
      const parsed = JSON.parse(state.lastResultText);
      if (isDataSqlResult(parsed)) renderResultTable(resultOut, parsed);
      else resultOut.textContent = state.lastResultText;
    } catch {
      resultOut.textContent = state.lastResultText;
    }
  } else {
    resultOut.textContent = '';
  }

  const copyText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // ignore
      }
    }
  };

  const refreshPreview = async () => {
    const now = new Date().toISOString();
    const lines: string[] = [];
    lines.push(`handle: ${selected}`);
    lines.push(`at: ${now}`);

    const resAll = await runDataSql(bridge, {
      handleRef: selected,
      sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all',
    });
    const resSel = await runDataSql(bridge, {
      handleRef: selected,
      sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle',
    });

    const fmt = (r: VacpActionResult) => {
      if (!r.ok) return `error: ${(r as any)?.error?.message ?? 'unknown error'}`;
      const rr = r.result;
      if (isDataSqlResult(rr) && rr.format === 'json') return safeJson(rr.rows?.[0] ?? {});
      return safeJson(rr);
    };
    lines.push(`vacp_all: ${fmt(resAll)}`);
    lines.push(`vacp_handle: ${fmt(resSel)}`);
    const text = lines.join('\n');
    onChange({ lastPreviewText: text, lastPreviewAt: now });
  };

  refreshPreviewBtn.addEventListener('click', () => void refreshPreview().catch(() => {}));

  runBtn.addEventListener('click', async () => {
    onChange({ lastErrorText: '' });
    try {
      const sql = textarea.value.trim();
      if (!sql) return;
      const res = await runDataSql(bridge, { handleRef: selected, sql, maxRows: 50 });
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
    if (state.lastResultText) void copyText(state.lastResultText);
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
    resultTitle,
    resultOut,
  );

  // If the tab is opened and there is no preview yet for this handle, auto-run
  // the lightweight preview once to keep the pane immediately useful.
  if (!state.lastPreviewAt || !state.lastPreviewText) {
    void refreshPreview().catch(() => {});
  }
}

export function createInitialDataUiState(): DataUiState {
  return { queryText: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all' };
}
