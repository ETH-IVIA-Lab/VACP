import type { PostHog } from 'posthog-js';
import type { VacpAnalyticsProvider } from './types';

export function createPosthogProvider(
  client: Pick<PostHog, 'capture' | 'register_for_session'>,
): VacpAnalyticsProvider {
  return {
    capture: (event, properties) => {
      client.capture(event, properties);
    },
    setSessionProperties: (properties) => {
      client.register_for_session(properties);
    },
  };
}
