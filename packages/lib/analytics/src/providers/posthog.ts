import posthog from 'posthog-js';

import type { VacpAnalyticsProvider } from '../types';

export type VacpPosthogOptions = Readonly<{
  apiKey: string;
  apiHost?: string;
  /**
   * Extra `posthog.init` config (passed through as-is).
   * Useful for `defaults`, `person_profiles`, `session_recording`, etc.
   */
  config?: Record<string, unknown>;
}>;

const DEFAULT_API_HOST = 'https://us.i.posthog.com';

function initPosthogOnce(options: VacpPosthogOptions): void {
  // `posthog-js` is a singleton. We guard init so re-installing VACP (or switching
  // gallery views) doesn’t spam init calls.
  const g = globalThis as unknown as { __vacpPosthogInitKey?: string };
  const initKey = `${options.apiKey}|${options.apiHost ?? DEFAULT_API_HOST}`;
  if (g.__vacpPosthogInitKey) {
    if (g.__vacpPosthogInitKey !== initKey) {
      // eslint-disable-next-line no-console
      console.warn('PostHog is already initialized; ignoring a second init call with different config.');
    }
    return;
  }
  g.__vacpPosthogInitKey = initKey;

  posthog.init(options.apiKey, {
    api_host: options.apiHost ?? DEFAULT_API_HOST,
    // Keep PostHog profiles opt-in by default; override by passing `config.person_profiles`.
    person_profiles: 'identified_only',
    ...options.config,
  });
}

export function createPosthogProvider(options: VacpPosthogOptions): VacpAnalyticsProvider {
  initPosthogOnce(options);

  // PostHog has a few session-specific APIs that are perfect for replay metadata.
  const posthogAny = posthog as unknown as {
    register_for_session?: (properties: Record<string, unknown>) => void;
    startSessionRecording?: () => void;
    capture?: (event: string, properties?: Record<string, unknown>) => void;
  };

  return {
    name: 'posthog',
    capture: (event, properties) => {
      posthogAny.capture?.(event, properties);
    },
    setSessionProperties: (properties) => {
      posthogAny.register_for_session?.(properties);
    },
    startSessionRecording: () => posthogAny.startSessionRecording?.(),
  };
}
