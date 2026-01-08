import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

import { shouldEnable } from './enabled';
import { ensureStyles } from './styles';
import type { VacpDebugUiOptions } from './types';
import { VacpDebugUiApp } from './react/debug-ui-app';

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-react-root')) return;

  ensureStyles();

  const globalKey = options?.globalKey ?? '__vacp';
  const includeActions = options?.includeActions ?? true;

  const container = document.createElement('div');
  container.id = 'vacp-debug-ui-react-root';
  document.body.append(container);

  createRoot(container).render(createElement(VacpDebugUiApp, { globalKey, includeActions }));
}
