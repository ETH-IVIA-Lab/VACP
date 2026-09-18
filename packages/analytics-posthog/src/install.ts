import type { VacpRuntimeBridge } from '@vacp/protocol';

import { installVacpRuntimeAnalytics } from '@vacp/analytics';
import type { VacpRuntimeAnalyticsInstallation, VacpRuntimeAnalyticsOptions } from '@vacp/analytics';
import { createPosthogProvider, type VacpPosthogOptions } from './provider.js';

export type InstallVacpPosthogAnalyticsArgs = Readonly<{
  bridge: VacpRuntimeBridge;
  posthog: VacpPosthogOptions;
  analytics?: VacpRuntimeAnalyticsOptions;
}>;

/**
 * Convenience installer: sets up PostHog + streams VACP runtime history into it.
 */
export function installVacpPosthogAnalytics(args: InstallVacpPosthogAnalyticsArgs): VacpRuntimeAnalyticsInstallation {
  const provider = createPosthogProvider(args.posthog);

  return installVacpRuntimeAnalytics({ bridge: args.bridge, provider, options: args.analytics });
}
