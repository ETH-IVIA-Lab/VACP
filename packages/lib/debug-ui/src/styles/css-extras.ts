export const CSS_EXTRAS = `

  .vacp-debug-ui-icon {
    display: inline-block;
    flex: 0 0 auto;
    color: rgba(231, 233, 238, 0.88);
  }
  .vacp-debug-ui-module .vacp-debug-ui-icon {
    color: rgba(231, 233, 238, 0.9);
  }
  .vacp-debug-ui-module[aria-current="true"] .vacp-debug-ui-icon {
    color: rgba(121, 178, 255, 0.9);
  }

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

  .vacp-debug-ui-list {
    display: grid;
    gap: 8px;
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

  .vacp-debug-ui-row[data-vacp-row="history-entry"] {
    border-left-width: 4px;
  }
  .vacp-debug-ui-row[data-vacp-row="history-entry"][data-source="human"] {
    border-left-color: rgba(122, 255, 182, 0.55);
  }
  .vacp-debug-ui-row[data-vacp-row="history-entry"][data-source="agent"] {
    border-left-color: rgba(176, 126, 255, 0.55);
  }
  .vacp-debug-ui-row[data-vacp-row="history-entry"][data-source="system"] {
    border-left-color: rgba(255, 206, 115, 0.55);
  }
  .vacp-debug-ui-row[data-vacp-row="history-entry"][data-source="debug"] {
    border-left-color: rgba(121, 178, 255, 0.55);
  }
  .vacp-debug-ui-row[data-vacp-row="history-entry"][data-source="unknown"] {
    border-left-color: rgba(231, 233, 238, 0.2);
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

  .vacp-debug-ui-pane-fill {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto auto auto 1fr;
    gap: 0;
  }

  .vacp-debug-ui-table-wrap {
    border: 1px solid var(--vacp-border-weak);
    border-radius: 10px;
    overflow: auto;
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
    background: rgba(231, 233, 238, 0.03);
    overflow: hidden;
    min-height: 0;
    height: 100%;
    display: flex;
    position: relative;
  }
  .vacp-debug-ui-diagram[data-stale='1'] svg {
    opacity: 0.68;
    filter: grayscale(0.12);
  }
  .vacp-debug-ui-diagram svg {
    background: white;
    border-radius: 10px;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    flex: 1 1 auto;
  }
  .vacp-debug-ui-diagram svg g.node.vacp-selected rect {
    stroke: rgba(121, 178, 255, 0.85) !important;
    stroke-width: 3px !important;
  }

  .vacp-debug-ui-role-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    border: 1px solid rgba(231, 233, 238, 0.18);
    background: rgba(231, 233, 238, 0.14);
    box-shadow: 0 0 0 2px rgba(11, 16, 32, 0.85);
    flex: 0 0 auto;
  }
  .vacp-debug-ui-role-dot[data-role='human'] {
    background: rgba(121, 178, 255, 0.9);
  }
  .vacp-debug-ui-role-dot[data-role='agent'] {
    background: rgba(188, 140, 255, 0.9);
  }
  .vacp-debug-ui-role-dot[data-role='system'] {
    background: rgba(231, 233, 238, 0.6);
  }
  .vacp-debug-ui-role-dot[data-role='debug'] {
    background: rgba(122, 255, 182, 0.9);
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
  .vacp-debug-ui-resizer-left {
    right: auto;
    left: 0;
    cursor: nesw-resize;
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 12px;
    transform: scaleX(-1);
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
