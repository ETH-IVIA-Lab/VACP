const CSS = `
  .vacp-debug-ui-root {
    --vacp-bg: #0b1020;
    --vacp-fg: #e7e9ee;
    --vacp-muted: rgba(231, 233, 238, 0.8);
    --vacp-border: rgba(231, 233, 238, 0.18);
    --vacp-border-weak: rgba(231, 233, 238, 0.12);
    --vacp-surface: rgba(231, 233, 238, 0.08);
    --vacp-surface-2: rgba(231, 233, 238, 0.12);
    --vacp-accent: rgba(121, 178, 255, 0.9);
  }

  .vacp-debug-ui-root {
    position: fixed;
    z-index: 2147483647;
    touch-action: none;
    transition: none;
  }
  .vacp-debug-ui-root.vacp-debug-ui-snap {
    transition:
      left 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
      top 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .vacp-debug-ui-root.vacp-debug-ui-dragging {
    transition: none !important;
  }

  .vacp-debug-ui-button {
    background: var(--vacp-bg);
    color: var(--vacp-fg);
    border: 1px solid rgba(231, 233, 238, 0.2);
    border-radius: 999px;
    padding: 8px 12px;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: grab;
    user-select: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
  .vacp-debug-ui-button:active {
    cursor: grabbing;
  }

  .vacp-debug-ui-panel {
    position: fixed;
    z-index: 2147483647;
    width: min(860px, calc(100vw - 28px));
    height: min(680px, calc(100vh - 92px));
    background: var(--vacp-bg);
    color: var(--vacp-fg);
    border: 1px solid rgba(231, 233, 238, 0.2);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    display: none;
  }

  .vacp-debug-ui-header {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vacp-border-weak);
  }
  .vacp-debug-ui-header-left {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .vacp-debug-ui-title {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.92;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vacp-debug-ui-modulebar {
    display: flex;
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .vacp-debug-ui-modulebar::-webkit-scrollbar {
    height: 6px;
  }
  .vacp-debug-ui-modulebar::-webkit-scrollbar-thumb {
    background: rgba(231, 233, 238, 0.18);
    border-radius: 999px;
  }
  .vacp-debug-ui-module {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--vacp-surface-2);
    color: var(--vacp-fg);
    border: 1px solid var(--vacp-border);
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1;
    white-space: nowrap;
  }
  .vacp-debug-ui-module[aria-current="true"] {
    border-color: rgba(121, 178, 255, 0.6);
    box-shadow: 0 0 0 2px rgba(121, 178, 255, 0.18) inset;
  }

  .vacp-debug-ui-header-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: nowrap;
    overflow-x: auto;
    max-width: 46vw;
    padding-bottom: 2px;
  }
  .vacp-debug-ui-header-actions::-webkit-scrollbar {
    height: 6px;
  }
  .vacp-debug-ui-header-actions::-webkit-scrollbar-thumb {
    background: rgba(231, 233, 238, 0.18);
    border-radius: 999px;
  }

  .vacp-debug-ui-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .vacp-debug-ui-actions button,
  .vacp-debug-ui-header-actions button {
    background: var(--vacp-surface-2);
    color: var(--vacp-fg);
    border: 1px solid var(--vacp-border);
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1;
    white-space: nowrap;
  }
  .vacp-debug-ui-actions button[disabled],
  .vacp-debug-ui-header-actions button[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .vacp-debug-ui-actions button[aria-pressed="true"],
  .vacp-debug-ui-header-actions button[aria-pressed="true"] {
    background: rgba(231, 233, 238, 0.18);
    border-color: rgba(231, 233, 238, 0.22);
  }

  .vacp-debug-ui-content {
    height: calc(100% - 56px);
    overflow: auto;
    padding: 12px;
  }

  .vacp-debug-ui-section-title {
    font: 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.75;
    margin: 14px 0 8px 0;
  }

  .vacp-debug-ui-small {
    font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    opacity: 0.9;
    white-space: pre-wrap;
  }

  .vacp-debug-ui-field {
    display: grid;
    gap: 6px;
    margin: 10px 0;
  }
  .vacp-debug-ui-field label {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.9;
  }
  .vacp-debug-ui-field textarea,
  .vacp-debug-ui-field input,
  .vacp-debug-ui-field select {
    width: 100%;
    background: var(--vacp-surface);
    border: 1px solid var(--vacp-border);
    color: var(--vacp-fg);
    border-radius: 10px;
    padding: 8px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    box-sizing: border-box;
  }
  .vacp-debug-ui-field textarea {
    min-height: 120px;
    resize: vertical;
    white-space: pre;
  }
  .vacp-debug-ui-field input {
    white-space: normal;
  }

  .vacp-debug-ui-list {
    display: grid;
    gap: 8px;
    max-height: 280px;
    overflow: auto;
  }

  .vacp-debug-ui-row {
    border: 1px solid var(--vacp-border-weak);
    border-radius: 10px;
    padding: 10px;
    cursor: pointer;
    background: rgba(231, 233, 238, 0.06);
  }
  .vacp-debug-ui-row:hover {
    background: rgba(231, 233, 238, 0.1);
  }
  .vacp-debug-ui-row[aria-selected="true"] {
    outline: 2px solid rgba(121, 178, 255, 0.22);
  }

  .vacp-debug-ui-table-wrap {
    border: 1px solid var(--vacp-border-weak);
    border-radius: 10px;
    overflow: auto;
    max-height: 280px;
    background: rgba(231, 233, 238, 0.04);
  }
  .vacp-debug-ui-table {
    width: 100%;
    border-collapse: collapse;
    font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  }
  .vacp-debug-ui-table th,
  .vacp-debug-ui-table td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(231, 233, 238, 0.08);
    vertical-align: top;
    text-align: left;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vacp-debug-ui-table th {
    position: sticky;
    top: 0;
    background: rgba(11, 16, 32, 0.98);
    z-index: 1;
  }

  .vacp-debug-ui-diagram {
    border: 1px solid var(--vacp-border-weak);
    border-radius: 12px;
    padding: 10px;
    background: rgba(231, 233, 238, 0.03);
    overflow: auto;
    max-height: 520px;
  }
  .vacp-debug-ui-diagram svg {
    background: white;
    border-radius: 10px;
    padding: 10px;
    max-width: 100%;
    height: auto;
  }

  .vacp-debug-ui-resizer {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    background:
      linear-gradient(135deg, transparent 0 45%, rgba(231, 233, 238, 0.22) 45% 55%, transparent 55% 100%),
      linear-gradient(135deg, transparent 0 65%, rgba(231, 233, 238, 0.16) 65% 75%, transparent 75% 100%);
    border-bottom-right-radius: 12px;
    opacity: 0.75;
  }
  .vacp-debug-ui-panel.vacp-debug-ui-resizing {
    user-select: none;
  }
`;

export function ensureStyles(): void {
  if (document.getElementById('vacp-debug-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'vacp-debug-ui-style';
  style.textContent = CSS;
  document.head.append(style);
}
