import type { VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

export function renderHistoryPane(
  container: HTMLElement,
  runtime: VacpRuntimeSnapshot,
  bridge: VacpWindowBridge,
): void {
  container.textContent = '';

  const title = document.createElement('div');
  title.className = 'vacp-debug-ui-section-title';
  title.textContent = 'Timeline';

  const list = document.createElement('div');
  list.className = 'vacp-debug-ui-list';

  const selectedCursor = runtime.cursor;
  runtime.history.forEach((e, idx) => {
    const row = document.createElement('div');
    row.className = 'vacp-debug-ui-row';
    row.setAttribute('aria-selected', idx === selectedCursor && runtime.mode === 'inspect' ? 'true' : 'false');
    const label = [
      `${idx}`,
      e.kind,
      e.source,
      e.call?.name ? `action=${e.call.name}` : '',
      e.message ? `msg=${e.message}` : '',
    ]
      .filter(Boolean)
      .join(' • ');
    row.textContent = label;
    row.title = 'Click to inspect this entry (does not mutate the live app)';
    row.addEventListener('click', () => {
      bridge.setCursor?.(idx, { source: 'debug', message: 'inspect' });
    });
    list.append(row);
  });

  const hint = document.createElement('div');
  hint.className = 'vacp-debug-ui-small';
  hint.textContent =
    'Tip: entries are captured on agent actions (execute), explicit refresh, and provider-driven human changes (if supported).';

  const detailsTitle = document.createElement('div');
  detailsTitle.className = 'vacp-debug-ui-section-title';
  detailsTitle.textContent = 'Selected entry';

  const details = document.createElement('div');
  details.className = 'vacp-debug-ui-small';
  const idx = runtime.mode === 'inspect' ? runtime.cursor : runtime.history.length - 1;
  const selected = idx >= 0 ? runtime.history[idx] : null;
  details.textContent = selected ? JSON.stringify(selected, null, 2) : '(no history yet)';

  container.append(title, list, hint, detailsTitle, details);
}
