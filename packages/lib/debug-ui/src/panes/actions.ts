import type { VacpActionCall, VacpActionDescriptor, VacpActionResult, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function tryFormatJson(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = safeParseJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, text: JSON.stringify(parsed.value, null, 2) };
}

function templateFromSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  if (depth > 4) return {};
  const s = schema as Record<string, unknown>;
  const type = s.type;
  if (type === 'string') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') {
    const items = s.items;
    return [templateFromSchema(items, depth + 1)];
  }
  const props = s.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const out: Record<string, unknown> = {};
    Object.entries(props).forEach(([k, v]) => {
      out[k] = templateFromSchema(v, depth + 1);
    });
    return out;
  }
  return {};
}

function copyText(text: string): void {
  const t = text ?? '';
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(t).catch(() => {});
    return;
  }
  const el = document.createElement('textarea');
  el.value = t;
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.append(el);
  el.select();
  try {
    document.execCommand('copy');
  } catch {
    // ignore
  } finally {
    el.remove();
  }
}

function findDescriptor(actions: VacpActionDescriptor[], name: string): VacpActionDescriptor | null {
  return actions.find((a) => a.name === name) ?? null;
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
  const initialSelected = state.selectedAction ?? actions[0]?.name ?? '';

  const searchField = document.createElement('div');
  searchField.className = 'vacp-debug-ui-field';
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Search';
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Filter action names…';
  search.title = 'Type to filter the action list.';
  searchField.append(searchLabel, search);

  const selectField = document.createElement('div');
  selectField.className = 'vacp-debug-ui-field';
  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Action';
  const select = document.createElement('select');
  select.title = 'Pick an action registered by the provider';

  const setOptions = (filter: string) => {
    const f = filter.trim().toLowerCase();
    const items = f ? actions.filter((a) => a.name.toLowerCase().includes(f)) : actions;
    const selected = select.value || initialSelected;
    select.textContent = '';
    items.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      select.append(opt);
    });
    if (items.some((a) => a.name === selected)) select.value = selected;
    else select.value = items[0]?.name ?? '';
  };
  setOptions('');

  select.value = initialSelected;
  select.addEventListener('change', () => onChange({ selectedAction: select.value }));

  selectField.append(selectLabel, select);

  search.addEventListener('input', () => setOptions(search.value));

  const detailsTitle = document.createElement('div');
  detailsTitle.className = 'vacp-debug-ui-section-title';
  detailsTitle.textContent = 'Details';

  const details = document.createElement('div');
  details.className = 'vacp-debug-ui-small';

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

  const templateBtn = document.createElement('button');
  templateBtn.type = 'button';
  templateBtn.textContent = 'Insert template';
  templateBtn.title = 'Generate a minimal params object from the action schema (best-effort).';

  const formatBtn = document.createElement('button');
  formatBtn.type = 'button';
  formatBtn.textContent = 'Format JSON';
  formatBtn.title = 'Format the params JSON (keeps values).';

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.textContent = 'Run';
  runBtn.title = 'Dispatch the selected action (source=debug) and record it in history';

  const copyCallBtn = document.createElement('button');
  copyCallBtn.type = 'button';
  copyCallBtn.textContent = 'Copy call';
  copyCallBtn.title = 'Copy the VacpActionCall JSON you are about to dispatch.';

  const copyResultBtn = document.createElement('button');
  copyResultBtn.type = 'button';
  copyResultBtn.textContent = 'Copy result';
  copyResultBtn.title = 'Copy the last action result JSON.';
  copyResultBtn.disabled = true;

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Clear the output.';

  const resultEl = document.createElement('div');
  resultEl.className = 'vacp-debug-ui-small';
  resultEl.textContent = '';

  const updateDetails = () => {
    const desc = findDescriptor(actions, select.value);
    details.textContent = desc
      ? safeStringify({
          name: desc.name,
          description: desc.description ?? null,
          targetRef: desc.targetRef ?? null,
          parameters: desc.parameters ?? {},
        })
      : '(unknown action)';
  };
  updateDetails();

  select.addEventListener('change', () => {
    updateDetails();
    if (!textarea.value.trim()) textarea.value = '{}';
  });

  templateBtn.addEventListener('click', () => {
    const desc = findDescriptor(actions, select.value);
    const next = desc ? templateFromSchema(desc.parameters) : {};
    textarea.value = JSON.stringify(next, null, 2);
    onChange({ paramsText: textarea.value });
  });

  formatBtn.addEventListener('click', () => {
    const next = tryFormatJson(textarea.value);
    if (!next.ok) {
      resultEl.textContent = `Invalid JSON: ${next.error}`;
      return;
    }
    textarea.value = next.text;
    onChange({ paramsText: textarea.value });
  });

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
    resultEl.textContent = safeStringify(res);
    copyResultBtn.disabled = false;
  });

  copyCallBtn.addEventListener('click', () => {
    const parsed = safeParseJson(textarea.value);
    if (!parsed.ok) {
      resultEl.textContent = `Invalid JSON: ${parsed.error}`;
      return;
    }
    const call: VacpActionCall = { callId: '…', name: select.value, params: parsed.value };
    copyText(safeStringify(call));
  });

  copyResultBtn.addEventListener('click', () => copyText(resultEl.textContent || ''));
  clearBtn.addEventListener('click', () => {
    resultEl.textContent = '';
    copyResultBtn.disabled = true;
  });

  btnRow.append(templateBtn, formatBtn, runBtn, copyCallBtn, copyResultBtn, clearBtn);
  container.append(title, searchField, selectField, detailsTitle, details, paramsField, btnRow, resultEl);
}
