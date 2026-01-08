export const CSS_EXTRAS = `

  .vacp-debug-ui-inline-label {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.9;
    padding-right: 4px;
    user-select: none;
  }

  .vacp-debug-ui-details {
    border: 1px solid var(--vacp-border-weak);
    border-radius: 10px;
    padding: 8px 10px;
    background: rgba(231, 233, 238, 0.03);
    margin: 8px 0;
  }
  .vacp-debug-ui-details summary {
    cursor: pointer;
    user-select: none;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.92;
    margin-bottom: 6px;
  }

  .vacp-debug-ui-sql {
    position: relative;
    border: 1px solid var(--vacp-border);
    border-radius: 10px;
    background: rgba(231, 233, 238, 0.06);
    overflow: hidden;
  }
  .vacp-debug-ui-sql-highlight {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 8px;
    overflow: auto;
    pointer-events: none;
    color: rgba(231, 233, 238, 0.92);
    font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    line-height: 1.45;
    white-space: pre;
  }
  .vacp-debug-ui-sql-highlight {
    scrollbar-width: none;
  }
  .vacp-debug-ui-sql-highlight::-webkit-scrollbar {
    display: none;
  }
  .vacp-debug-ui-sql-input {
    width: 100%;
    background: transparent !important;
    border: none !important;
    color: transparent !important;
    caret-color: var(--vacp-fg);
    -webkit-text-fill-color: transparent;
    padding: 8px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    line-height: 1.45;
    box-sizing: border-box;
    min-height: 140px;
    resize: vertical;
    white-space: pre;
    overflow: auto;
    outline: none;
  }
  .vacp-debug-ui-sql-input::selection {
    /* Keep selection visible without obscuring the syntax-highlighted layer. */
    background-color: rgba(121, 178, 255, 0.22) !important;
  }
  .vacp-debug-ui-sql-input::-moz-selection {
    background-color: rgba(121, 178, 255, 0.22) !important;
  }

  .vacp-sql-keyword {
    color: rgba(121, 178, 255, 0.95);
    font-weight: 600;
  }
  .vacp-sql-string {
    color: rgba(255, 206, 115, 0.95);
  }
  .vacp-sql-number {
    color: rgba(122, 255, 182, 0.92);
  }
  .vacp-sql-comment {
    color: rgba(231, 233, 238, 0.55);
  }
  .vacp-sql-ident {
    color: rgba(231, 233, 238, 0.9);
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
  .vacp-debug-ui-row[data-vacp-row="playbook-step"][data-status="done"] {
    background: rgba(122, 255, 182, 0.07);
    border-color: rgba(122, 255, 182, 0.16);
  }
  .vacp-debug-ui-row[data-vacp-row="playbook-step"][data-status="next"] {
    background: rgba(121, 178, 255, 0.09);
    border-color: rgba(121, 178, 255, 0.22);
  }

  .vacp-debug-ui-playbook-summary {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--vacp-border-weak);
    border-radius: 10px;
    background: rgba(231, 233, 238, 0.03);
    margin-bottom: 10px;
  }

  .vacp-debug-ui-playbook-step-title {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.2;
    margin-bottom: 6px;
  }
  .vacp-debug-ui-playbook-step-meta {
    font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    opacity: 0.82;
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

  @media (max-width: 520px) {
    .vacp-debug-ui-shell {
      grid-template-columns: 1fr;
    }
    .vacp-debug-ui-nav {
      border-right: none;
      border-bottom: 1px solid var(--vacp-border-weak);
    }
    .vacp-debug-ui-nav-select {
      display: block;
    }
    .vacp-debug-ui-nav-list {
      display: none;
    }
  }
`;
