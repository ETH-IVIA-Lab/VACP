export const CSS_BASE = `
  .vacp-debug-ui-root,
  .vacp-debug-ui-panel {
    --vacp-bg: #0b1020;
    --vacp-fg: #e7e9ee;
    --vacp-muted: rgba(231, 233, 238, 0.8);
    --vacp-border: rgba(231, 233, 238, 0.18);
    --vacp-border-weak: rgba(231, 233, 238, 0.12);
    --vacp-surface: rgba(231, 233, 238, 0.08);
    --vacp-surface-2: rgba(231, 233, 238, 0.12);
    --vacp-accent: rgba(121, 178, 255, 0.9);
    --vacp-debug-ui-z: 2147483000;
  }

  .vacp-debug-ui-root {
    position: fixed;
    z-index: var(--vacp-debug-ui-z);
    touch-action: none;
    isolation: isolate;
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
    display: inline-flex;
    align-items: center;
  }
  .vacp-debug-ui-button::after {
    content: '';
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-left: 10px;
    border-radius: 999px;
    background: rgba(231, 233, 238, 0.42);
    box-shadow: 0 0 0 2px rgba(11, 16, 32, 0.8);
  }
  .vacp-debug-ui-button[data-bridge='ok']::after {
    background: rgba(122, 255, 182, 0.95);
  }
  .vacp-debug-ui-button[data-bridge='unknown']::after {
    background: rgba(255, 206, 115, 0.95);
  }
  .vacp-debug-ui-button:active {
    cursor: grabbing;
  }

  .vacp-debug-ui-panel {
    position: fixed;
    z-index: calc(var(--vacp-debug-ui-z) + 1);
    width: min(860px, calc(100vw - 28px));
    height: min(680px, calc(100vh - 92px));
    background: var(--vacp-bg);
    color: var(--vacp-fg);
    border: 1px solid rgba(231, 233, 238, 0.2);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    display: none;
    isolation: isolate;
    grid-template-rows: auto 1fr;
    opacity: 1;
    mix-blend-mode: normal;
    background-image: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .vacp-debug-ui-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vacp-border-weak);
    background: var(--vacp-bg);
  }
  .vacp-debug-ui-title {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    opacity: 0.92;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .vacp-debug-ui-header-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    padding-left: 10px;
    margin-left: auto;
  }

  .vacp-debug-ui-shell {
    height: calc(100% - 44px);
    display: grid;
    grid-template-columns: 180px 1fr;
    min-height: 0;
  }

  .vacp-debug-ui-nav {
    padding: 10px;
    border-right: 1px solid var(--vacp-border-weak);
    background: rgba(231, 233, 238, 0.03);
    min-height: 0;
    overflow: hidden;
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .vacp-debug-ui-nav-select {
    width: 100%;
    background: var(--vacp-surface);
    border: 1px solid var(--vacp-border);
    color: var(--vacp-fg);
    border-radius: 10px;
    padding: 8px;
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: none;
  }

  .vacp-debug-ui-nav-list {
    display: grid;
    gap: 6px;
    overflow: auto;
    padding-right: 2px;
  }

  .vacp-debug-ui-module {
    display: flex;
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
    width: 100%;
    text-align: left;
  }
  .vacp-debug-ui-module[aria-current="true"] {
    border-color: rgba(121, 178, 255, 0.6);
    box-shadow: 0 0 0 2px rgba(121, 178, 255, 0.18) inset;
  }

  .vacp-debug-ui-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    margin: 8px 0;
  }

  .vacp-debug-ui-actions button,
  .vacp-debug-ui-header button {
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

  .vacp-debug-ui-icon-button {
    width: 34px;
    height: 34px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: var(--vacp-surface-2);
    color: var(--vacp-fg);
    border: 1px solid var(--vacp-border);
    cursor: pointer;
  }
  .vacp-debug-ui-icon-button[data-variant='primary'] {
    border-color: rgba(121, 178, 255, 0.55);
    box-shadow: 0 0 0 2px rgba(121, 178, 255, 0.16) inset;
  }
  .vacp-debug-ui-icon-button[data-variant='danger'] {
    border-color: rgba(255, 90, 90, 0.45);
    box-shadow: 0 0 0 2px rgba(255, 90, 90, 0.12) inset;
  }

  .vacp-debug-ui-page {
    height: 100%;
    min-height: 0;
    display: grid;
    gap: 12px;
  }
  .vacp-debug-ui-grid {
    min-width: 0;
    min-height: 0;
    display: grid;
    gap: 12px;
  }
  .vacp-debug-ui-grid-2 {
    grid-template-columns: 360px 1fr;
  }
  .vacp-debug-ui-grid-1fr-360 {
    grid-template-columns: 1fr 360px;
  }
  @media (max-width: 900px) {
    .vacp-debug-ui-grid-2 {
      grid-template-columns: 1fr;
    }
    .vacp-debug-ui-grid-1fr-360 {
      grid-template-columns: 1fr;
    }
  }

  .vacp-debug-ui-card {
    border: 1px solid var(--vacp-border-weak);
    border-radius: 12px;
    background: rgba(231, 233, 238, 0.03);
    padding: 12px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .vacp-debug-ui-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .vacp-debug-ui-card-title {
    font: 12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.78;
    line-height: 1.2;
  }
  .vacp-debug-ui-card-subtitle {
    font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    opacity: 0.86;
    margin-top: 6px;
    white-space: pre-wrap;
  }
  .vacp-debug-ui-toolbar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .vacp-debug-ui-scroll {
    min-height: 0;
    overflow: auto;
  }

  .vacp-debug-ui-code {
    font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    white-space: pre;
    overflow: auto;
    padding: 10px;
    border: 1px solid rgba(231, 233, 238, 0.1);
    border-radius: 10px;
    background: rgba(11, 16, 32, 0.78);
  }
  .vacp-debug-ui-actions button[disabled],
  .vacp-debug-ui-header button[disabled] {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .vacp-debug-ui-actions button[aria-pressed="true"],
  .vacp-debug-ui-header button[aria-pressed="true"] {
    background: rgba(231, 233, 238, 0.18);
    border-color: rgba(231, 233, 238, 0.22);
  }

  .vacp-debug-ui-content {
    height: 100%;
    overflow: auto;
    padding: 12px;
    min-width: 0;
    min-height: 0;
    background: var(--vacp-bg);
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
`;
