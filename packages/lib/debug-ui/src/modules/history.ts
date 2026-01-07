import type { VacpActionCall, VacpHistoryEntry, VacpRef } from '@vacp/core';

import type { VacpDebugModule } from '../types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
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

function labelForEntry(e: VacpHistoryEntry, idx: number): string {
  const parts: string[] = [];
  parts.push(`#${idx}`);
  parts.push(e.kind);
  if (e.source) parts.push(e.source);
  if (e.call?.name) parts.push(e.call.name);
  if (e.message) parts.push(e.message);
  return parts.join(' • ');
}

export function createHistoryModule(): VacpDebugModule {
  let selectedIdx: number | null = null;
  let lastOutput = '';

  return {
    id: 'history',
    title: 'History',
    icon: '⏱️',
    render: (container, ctx) => {
      container.textContent = '';

      const title = document.createElement('div');
      title.className = 'vacp-debug-ui-section-title';
      title.textContent = 'Timeline';

      const hint = document.createElement('div');
      hint.className = 'vacp-debug-ui-small';
      hint.textContent =
        'Select an entry to inspect it, or apply its state to the live app (rewind). Inspect does not mutate the app; apply does.';

      const list = document.createElement('div');
      list.className = 'vacp-debug-ui-list';

      const entries = ctx.runtime.history;
      if (!entries.length) {
        container.append(title, hint, document.createTextNode('\n(no history yet)\n'));
        return;
      }

      const fallbackIdx = ctx.runtime.mode === 'inspect' ? ctx.runtime.cursor : entries.length - 1;
      if (selectedIdx === null || selectedIdx < 0 || selectedIdx >= entries.length) selectedIdx = fallbackIdx;

      entries.forEach((e, idx) => {
        const row = document.createElement('div');
        row.className = 'vacp-debug-ui-row';
        row.setAttribute('aria-selected', idx === selectedIdx ? 'true' : 'false');
        row.textContent = labelForEntry(e, idx);
        row.title = 'Click to select. Double-click to apply this entry state to the live app.';
        row.addEventListener('click', () => {
          selectedIdx = idx;
          ctx.requestRender();
        });
        row.addEventListener('dblclick', () => {
          selectedIdx = idx;
          applyBtn.click();
        });
        list.append(row);
      });

      const actionsTitle = document.createElement('div');
      actionsTitle.className = 'vacp-debug-ui-section-title';
      actionsTitle.textContent = 'Selected entry';

      const btnRow = document.createElement('div');
      btnRow.className = 'vacp-debug-ui-actions';

      const inspectBtn = document.createElement('button');
      inspectBtn.type = 'button';
      inspectBtn.textContent = 'Inspect';
      inspectBtn.title = 'Move the runtime cursor to this entry (does not mutate the live app).';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply to live';
      applyBtn.title =
        'Execute vacp.apply_state using the selected entry state. This mutates the live app (rewind to that exact state).';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy entry';
      copyBtn.title = 'Copy the selected entry JSON.';

      btnRow.append(inspectBtn, applyBtn, copyBtn);

      const out = document.createElement('div');
      out.className = 'vacp-debug-ui-small';
      out.textContent = lastOutput;

      const details = document.createElement('div');
      details.className = 'vacp-debug-ui-small';
      const entry = entries[selectedIdx]!;
      details.textContent = safeJson(entry);

      inspectBtn.addEventListener('click', () => {
        ctx.bridge.setMode?.('inspect', { source: 'debug', message: 'inspect' });
        ctx.bridge.setCursor?.(selectedIdx!, { source: 'debug', message: 'inspect' });
        lastOutput = `Inspect cursor set to #${selectedIdx}`;
        out.textContent = lastOutput;
      });

      applyBtn.addEventListener('click', async () => {
        const state = entry.state?.state as Record<VacpRef, unknown> | undefined;
        if (!state) {
          lastOutput = 'Selected entry has no state snapshot to apply.';
          out.textContent = lastOutput;
          return;
        }
        const call: VacpActionCall = { callId: crypto.randomUUID(), name: 'vacp.apply_state', params: { state } };
        const res =
          typeof (ctx.bridge as any).dispatch === 'function'
            ? await (ctx.bridge as any).dispatch(call, { source: 'debug', message: 'apply history state' })
            : await ctx.bridge.execute(call);
        lastOutput = safeJson(res);
        out.textContent = lastOutput;
        ctx.bridge.setMode?.('live', { source: 'debug', message: 'live' });
        ctx.requestRender();
      });

      copyBtn.addEventListener('click', () => copyText(details.textContent || ''));

      container.append(title, hint, list, actionsTitle, btnRow, out, details);
    },
  };
}
