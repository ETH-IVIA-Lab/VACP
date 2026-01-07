import type { VacpRuntimeSnapshot, VacpRef } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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

export function renderJsonPane(
  container: HTMLElement,
  runtime: VacpRuntimeSnapshot,
  bridge: VacpWindowBridge,
  state: { text: string },
  onChange: (next: { text: string }) => void,
): void {
  container.textContent = '';

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Apply / override state';

  const hint = document.createElement('div');
  hint.className = 'vacp-debug-ui-small';
  hint.textContent =
    'Paste a JSON map keyed by vacp:// refs. You can either override state for inspection (no app mutation), or apply to the live app via vacp.apply_state.';

  const field = document.createElement('div');
  field.className = 'vacp-debug-ui-field';
  const label = document.createElement('label');
  label.textContent = 'State map (JSON)';
  const textarea = document.createElement('textarea');
  textarea.value = state.text;
  textarea.title = 'JSON object keyed by vacp:// refs';
  textarea.addEventListener('input', () => onChange({ text: textarea.value }));
  field.append(label, textarea);

  const btnRow = document.createElement('div');
  btnRow.className = 'vacp-debug-ui-actions';

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.textContent = 'Load current';
  loadBtn.title = 'Replace the editor with the current state snapshot (inspect cursor).';

  const formatBtn = document.createElement('button');
  formatBtn.type = 'button';
  formatBtn.textContent = 'Format JSON';
  formatBtn.title = 'Pretty-print the JSON in the editor.';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.title = 'Copy the current editor JSON.';

  const inspectBtn = document.createElement('button');
  inspectBtn.type = 'button';
  inspectBtn.textContent = 'Set override (inspect)';
  inspectBtn.title = 'Override runtime state for inspection (does not mutate the live app)';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear overrides';
  clearBtn.title = 'Remove inspection overrides and return to live snapshots';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = 'Apply state to live app';
  applyBtn.title = 'Execute vacp.apply_state on the live app (provider-defined, best-effort)';

  const out = document.createElement('div');
  out.className = 'vacp-debug-ui-small';
  out.textContent = '';

  loadBtn.addEventListener('click', () => {
    textarea.value = JSON.stringify(runtime.currentState.state, null, 2);
    onChange({ text: textarea.value });
    out.textContent = 'Loaded current state.';
  });

  formatBtn.addEventListener('click', () => {
    const parsed = safeParseJson(textarea.value);
    if (!parsed.ok) {
      out.textContent = `Invalid JSON: ${parsed.error}`;
      return;
    }
    textarea.value = JSON.stringify(parsed.value, null, 2);
    onChange({ text: textarea.value });
    out.textContent = 'Formatted.';
  });

  copyBtn.addEventListener('click', () => copyText(textarea.value));

  inspectBtn.addEventListener('click', () => {
    const parsed = safeParseJson(textarea.value);
    if (!parsed.ok) {
      out.textContent = `Invalid JSON: ${parsed.error}`;
      return;
    }
    if (typeof bridge.setStateOverride !== 'function') {
      out.textContent = 'Runtime does not support state overrides.';
      return;
    }
    const obj = parsed.value;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      out.textContent = 'Expected a JSON object keyed by vacp:// refs.';
      return;
    }
    bridge.setStateOverride(obj as Record<VacpRef, unknown>, { source: 'debug', message: 'state override' });
    out.textContent = 'Override set.';
  });

  clearBtn.addEventListener('click', () => {
    bridge.clearOverrides?.({ source: 'debug', message: 'clear overrides' });
    out.textContent = 'Overrides cleared.';
  });

  applyBtn.addEventListener('click', async () => {
    const parsed = safeParseJson(textarea.value);
    if (!parsed.ok) {
      out.textContent = `Invalid JSON: ${parsed.error}`;
      return;
    }
    const obj = parsed.value;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      out.textContent = 'Expected a JSON object keyed by vacp:// refs.';
      return;
    }
    const res = await bridge.execute({ callId: crypto.randomUUID(), name: 'vacp.apply_state', params: { state: obj } });
    out.textContent = JSON.stringify(res, null, 2);
  });

  btnRow.append(loadBtn, formatBtn, copyBtn, inspectBtn, clearBtn, applyBtn);

  const sampleTitle = document.createElement('div');
  sampleTitle.className = 'vacp-debug-ui-section-title';
  sampleTitle.textContent = 'Current state (inspect)';

  const sample = document.createElement('div');
  sample.className = 'vacp-debug-ui-small';
  sample.textContent = JSON.stringify(runtime.currentState.state, null, 2);

  container.append(title, hint, field, btnRow, out, sampleTitle, sample);
}
