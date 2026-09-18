import posthog, { type PostHogConfig } from 'posthog-js';

import type { VacpAnalyticsProvider } from '@vacp/analytics';

export type VacpPosthogOptions = Readonly<{
  apiKey: string;
  apiHost?: string;
  /**
   * Passes options such as `defaults`, `person_profiles`, and `session_recording`.
   */
  config?: Partial<PostHogConfig>;
}>;

const DEFAULT_API_HOST = 'https://us.i.posthog.com';

const POSTHOG_INIT_KEY = Symbol.for('vacp.analytics.posthog.initKey');

function initPosthogOnce(options: VacpPosthogOptions): void {
  // `posthog-js` is a singleton. Guard init so re-installing VACP, or switching
  // gallery views, does not repeat init calls.
  const initialized = Object.getOwnPropertyDescriptor(globalThis, POSTHOG_INIT_KEY)?.value;
  const initKey = `${options.apiKey}|${options.apiHost ?? DEFAULT_API_HOST}`;

  if (initialized) {
    if (initialized !== initKey) {
      console.warn('PostHog is already initialized. Ignoring a second init call with different config.');
    }

    return;
  }

  Object.defineProperty(globalThis, POSTHOG_INIT_KEY, { value: initKey, configurable: true });

  posthog.init(options.apiKey, {
    api_host: options.apiHost ?? DEFAULT_API_HOST,
    // Keep PostHog profiles opt-in by default; override by passing `config.person_profiles`.
    person_profiles: 'identified_only',
    ...options.config,
  });
}

export function createPosthogProvider(options: VacpPosthogOptions): VacpAnalyticsProvider {
  initPosthogOnce(options);

  return {
    name: 'posthog',
    capture: (event, properties) => {
      posthog.capture(event, properties);
    },
    setSessionProperties: (properties) => {
      posthog.register_for_session(properties);
    },
    startSessionRecording: () => posthog.startSessionRecording(),
  };
}
