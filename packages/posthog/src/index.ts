import type { PostHog } from 'posthog-js';
import { installVacpRuntimeAnalytics } from './analytics';
import { createPosthogProvider } from './provider';
import type { VacpRuntime } from '@ethivia/vacp-sdk';

export type VacpPosthogOptions = Readonly<{
  /** Include analytical state in captured events. Defaults to false. */
  captureSnapshots?: boolean;
  /** Properties added to every captured event. A function is read at capture time. */
  properties?: Record<string, unknown> | (() => Record<string, unknown>);
}>;

/**
 * Sends the runtime's provenance records to an initialized PostHog client as `vacp_*` events, and
 * registers the session's runtime properties. Dispose the installation to stop sending.
 */
export function installVacpPosthog(
  runtime: Pick<VacpRuntime, 'getProvenance' | 'subscribeProvenance' | 'version' | 'signal'>,
  posthog: Pick<PostHog, 'capture' | 'register_for_session'>,
  options: VacpPosthogOptions = {},
): { dispose: () => void } {
  const { properties } = options;
  return installVacpRuntimeAnalytics({
    bridge: runtime,
    provider: createPosthogProvider(posthog),
    captureSnapshots: options.captureSnapshots,
    getBaseProperties: typeof properties === 'function' ? properties : () => properties ?? {},
  });
}
