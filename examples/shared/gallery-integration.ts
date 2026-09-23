import type { VacpProvider } from '@vacp/protocol';
import type { PresenceBinding } from '@vacp/presence-core';
import { installVacpRuntime } from '@vacp/runtime-browser';
import { installVacpWebMcp } from '@vacp/transport-webmcp';
import { installVacpPosthogAnalytics, type VacpPosthogOptions } from '@vacp/analytics-posthog';
import { createExamplePresence } from './presence';
import { exampleOptions } from '../config';

/** One rendered gallery entry owns its bridge, presentation and optional transports. */
export async function installGalleryIntegration(args: {
  provider: VacpProvider;
  root: Element;
  presentation: Pick<PresenceBinding, 'resolve' | 'subscribe'>;
  sessionKey: string;
  globalKey?: string;
  signal: AbortSignal;
  analyticsProperties: Record<string, string>;
}): Promise<void> {
  args.signal.throwIfAborted();
  const integration = installVacpRuntime({
    providers: [args.provider],
    globalKey: args.globalKey,
    sessionKey: args.sessionKey,
    exposeBridge: exampleOptions.exposeBridge,
    injectDomSnapshot: exampleOptions.injectDomSnapshot,
  });
  const cleanup: Array<() => void> = [integration.dispose];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    args.signal.removeEventListener('abort', dispose);
    for (const release of cleanup.reverse()) release();
  };
  args.signal.addEventListener('abort', dispose, { once: true });
  try {
    const bridge = integration.runtime;
    const presence = createExamplePresence(bridge, args.root);
    cleanup.push(presence.dispose);
    presence.attach(args.provider, args.presentation);
    if (exampleOptions.webmcp) {
      const webmcp = await installVacpWebMcp(bridge);
      if (args.signal.aborted) {
        webmcp?.dispose();
        args.signal.throwIfAborted();
      }
      if (webmcp) cleanup.push(() => webmcp.dispose());
    }
    const apiKey = import.meta.env.VACP_POSTHOG_API_KEY as string | undefined;
    if (apiKey) {
      const defaults = import.meta.env.VACP_POSTHOG_DEFAULTS as string | undefined;
      const analytics = installVacpPosthogAnalytics({
        bridge,
        posthog: {
          apiKey,
          apiHost: import.meta.env.VACP_POSTHOG_API_HOST as string | undefined,
          config: defaults
            ? { defaults: defaults as NonNullable<VacpPosthogOptions['config']>['defaults'] }
            : undefined,
        },
        analytics: {
          getBaseProperties: () => args.analyticsProperties,
          captureSnapshots: import.meta.env.VACP_POSTHOG_CAPTURE_SNAPSHOTS === '1',
        },
      });
      cleanup.push(analytics.cleanup);
    }
  } catch (error) {
    dispose();
    throw error;
  }
}
