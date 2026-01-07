const CSS = `
  .vacp-debug-ui-root {
    position: fixed;
    z-index: 2147483647;
    touch-action: none;
    transition: none;
  }
  .vacp-debug-ui-root.vacp-debug-ui-snap {
    transition:
      left 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      top 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .vacp-debug-ui-root.vacp-debug-ui-dragging {
    transition: none !important;
  }
  .vacp-debug-ui-button {
    background: #0b1020;
    color: #e7e9ee;
    border: 1px solid rgba(231, 233, 238, 0.2);
    border-radius: 999px;
    padding: 8px 12px;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
  .vacp-debug-ui-panel {
    position: absolute;
    width: min(860px, calc(100vw - 28px));
    height: min(680px, calc(100vh - 92px));
    background: #0b1020;
    color: #e7e9ee;
    border: 1px solid rgba(231, 233, 238, 0.2);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    display: none;
  }
  .vacp-debug-ui-panel header {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    row-gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(231, 233, 238, 0.12);
  }
  .vacp-debug-ui-title {
    flex: 1;
    min-width: 220px;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.9;
    cursor: move;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vacp-debug-ui-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .vacp-debug-ui-actions button,
  .vacp-debug-ui-tab,
  .vacp-debug-ui-row button {
    background: rgba(231, 233, 238, 0.1);
    color: #e7e9ee;
    border: 1px solid rgba(231, 233, 238, 0.18);
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1;
    white-space: nowrap;
  }
  .vacp-debug-ui-actions button[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .vacp-debug-ui-body {
    display: grid;
    grid-template-columns: 1fr 340px;
    height: calc(100% - 45px);
  }
  .vacp-debug-ui-svg {
    padding: 10px;
    overflow: auto;
    background: #0b1020;
  }
  .vacp-debug-ui-svg svg {
    background: white;
    border-radius: 8px;
    padding: 10px;
    max-width: 100%;
    height: auto;
  }
  .vacp-debug-ui-code {
    border-left: 1px solid rgba(231, 233, 238, 0.12);
    padding: 10px;
    overflow: auto;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    white-space: pre;
    color: #e7e9ee;
  }
  .vacp-debug-ui-tabs {
    display: flex;
    gap: 6px;
    padding: 8px 0 10px 0;
    border-bottom: 1px solid rgba(231, 233, 238, 0.12);
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .vacp-debug-ui-tab[aria-selected="true"] {
    background: rgba(231, 233, 238, 0.18);
    border-color: rgba(231, 233, 238, 0.22);
  }
  .vacp-debug-ui-section-title {
    font: 11px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.75;
    margin: 10px 0 6px 0;
  }
  .vacp-debug-ui-small {
    font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    opacity: 0.85;
    white-space: pre-wrap;
  }
  .vacp-debug-ui-field {
    display: grid;
    gap: 6px;
    margin: 8px 0;
  }
  .vacp-debug-ui-field label {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.9;
  }
  .vacp-debug-ui-field textarea,
  .vacp-debug-ui-field select {
    width: 100%;
    background: rgba(231, 233, 238, 0.08);
    border: 1px solid rgba(231, 233, 238, 0.18);
    color: #e7e9ee;
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
  .vacp-debug-ui-row {
    border: 1px solid rgba(231, 233, 238, 0.12);
    border-radius: 10px;
    padding: 8px;
    cursor: pointer;
    background: rgba(231, 233, 238, 0.06);
  }
  .vacp-debug-ui-row:hover {
    background: rgba(231, 233, 238, 0.1);
  }
  .vacp-debug-ui-row[aria-selected="true"] {
    outline: 2px solid rgba(231, 233, 238, 0.25);
  }

  .vacp-debug-ui-table-wrap {
    border: 1px solid rgba(231, 233, 238, 0.12);
    border-radius: 10px;
    overflow: auto;
    max-height: 260px;
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
`;

export function ensureStyles(): void {
  if (document.getElementById('vacp-debug-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'vacp-debug-ui-style';
  style.textContent = CSS;
  document.head.append(style);
}
