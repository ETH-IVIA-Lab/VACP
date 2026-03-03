import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { shouldEnable } from '@vacp/debug-ui/enabled';
import type { VacpDebugUiOptions } from '@vacp/debug-ui/types';
import { VacpDebugUiApp } from '@vacp/debug-ui/overlay/debug-ui-app';

import './style.css';

export function installVacpDebugUi(options?: VacpDebugUiOptions): void {
  const enabled = options?.enabled ?? 'auto';
  if (!shouldEnable(enabled)) return;
  if (document.getElementById('vacp-debug-ui-react-root')) return;

  const globalKey = options?.globalKey ?? '__vacp';
  const includeActions = options?.includeActions ?? true;

  const container = document.createElement('div');
  container.id = 'vacp-debug-ui-react-root';
  document.body.append(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retryDelay: (attemptIndex) => Math.min(400 * 2 ** attemptIndex, 2_000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });

  createRoot(container).render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VacpDebugUiApp, { globalKey, includeActions }),
    ),
  );
}
