import type { VacpRuntimeBridge } from '@vacp/core';

import { installVacpRuntimeAnalytics } from './runtime';
import type { VacpRuntimeAnalyticsInstallation, VacpRuntimeAnalyticsOptions } from './types';
import { createPosthogProvider, type VacpPosthogOptions } from './providers/posthog';

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
