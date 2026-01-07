import type { VacpActionCall, VacpActionResult, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function renderActionsPane(
  container: HTMLElement,
  runtime: VacpRuntimeSnapshot,
  bridge: VacpWindowBridge,
  state: { selectedAction?: string; paramsText?: string },
  onChange: (next: { selectedAction?: string; paramsText?: string }) => void,
): void {
  container.textContent = '';

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Dispatch action';

  const actions = runtime.currentCapabilities.graph.actions ?? [];

  const selectField = document.createElement('div');
  selectField.className = 'vacp-debug-ui-field';
  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Action';
  const select = document.createElement('select');
  select.title = 'Pick an action registered by the provider';
  actions.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.name;
    opt.textContent = a.name;
    select.append(opt);
  });
  select.value = state.selectedAction ?? actions[0]?.name ?? '';
  select.addEventListener('change', () => {
    textarea.value = '{}';
    onChange({ selectedAction: select.value, paramsText: '{}' });
  });
  selectField.append(selectLabel, select);

  const paramsField = document.createElement('div');
  paramsField.className = 'vacp-debug-ui-field';
  const paramsLabel = document.createElement('label');
  paramsLabel.textContent = 'Params (JSON)';
  const textarea = document.createElement('textarea');
  textarea.value = state.paramsText ?? '{}';
  textarea.title = 'Enter a JSON object for params. This is sent to the provider as-is.';
  textarea.addEventListener('input', () => onChange({ paramsText: textarea.value }));
  paramsField.append(paramsLabel, textarea);

  const btnRow = document.createElement('div');
  btnRow.className = 'vacp-debug-ui-actions';

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.textContent = 'Run';
  runBtn.title = 'Dispatch the selected action (source=debug) and record it in history';

  const resultEl = document.createElement('div');
  resultEl.className = 'vacp-debug-ui-small';
  resultEl.textContent = '';

  runBtn.addEventListener('click', async () => {
    const parsed = safeParseJson(textarea.value);
    if (!parsed.ok) {
      resultEl.textContent = `Invalid JSON: ${parsed.error}`;
      return;
    }

    const call: VacpActionCall = { callId: crypto.randomUUID(), name: select.value, params: parsed.value };
    let res: VacpActionResult;
    if (typeof bridge.dispatch === 'function')
      res = await bridge.dispatch(call, { source: 'debug', message: 'debug dispatch' });
    else res = await bridge.execute(call);
    resultEl.textContent = JSON.stringify(res, null, 2);
  });

  btnRow.append(runBtn);
  container.append(title, selectField, paramsField, btnRow, resultEl);
}
