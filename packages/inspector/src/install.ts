import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { VacpInspectorOptions } from '@vacp/inspector/types';
import { VacpInspectorApp } from '@vacp/inspector/overlay/inspector-app';

import './style.css';

export interface VacpInspectorInstallation {
  dispose(): void;
}

let installation: VacpInspectorInstallation | undefined;

export function installVacpInspector(options?: VacpInspectorOptions): VacpInspectorInstallation {
  if (installation) return installation;

  const globalKey = options?.globalKey ?? '__vacp';
  const includeActions = options?.includeActions ?? false;

  const container = document.createElement('div');
  container.id = 'vacp-inspector-react-root';
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

  const root = createRoot(container);
  root.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VacpInspectorApp, { globalKey, includeActions }),
    ),
  );

  const handle: VacpInspectorInstallation = {
    dispose() {
      if (installation !== handle) return;
      root.unmount();
      queryClient.clear();
      container.remove();
      installation = undefined;
    },
  };

  installation = handle;

  return handle;
}
