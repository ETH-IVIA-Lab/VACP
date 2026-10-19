# @ethivia/vacp-analytics

Forwards a runtime's provenance to a telemetry provider. `@ethivia/vacp-analytics-posthog` provides the [PostHog](https://posthog.com) provider.

## installVacpRuntimeAnalytics

```ts
installVacpRuntimeAnalytics(options: {
  bridge: VacpProvenanceSource & { version: string; signal: AbortSignal };
  provider: VacpAnalyticsProvider;
  captureSnapshots?: boolean;
  getBaseProperties?: () => Record<string, unknown>;
}): { dispose(): void }
```

Captures a `vacp_runtime_init` event, then one `vacp_<kind>` event per action, turn, and session record, with the record's actor, operation, and outcome. It mirrors the latest 50 of those records into the session's properties, at most once a second, and starts session recording when the provider supports it. `captureSnapshots: true` adds each action's before and after state to its event, and also sends observation records, coalesced to at most one event a second. `getBaseProperties()` adds properties to every event, such as application and view IDs.

`dispose()` stops forwarding and cancels pending deliveries. Disposing the runtime does the same. Throws when the runtime is already disposed.

```ts
type VacpAnalyticsProvider = {
  capture(event: string, properties?: Record<string, unknown>): void;
  setSessionProperties?(properties: Record<string, unknown>): void;
  startSessionRecording?(): void;
};
```

## createPosthogProvider

```ts
import posthog from 'posthog-js';
import { installVacpRuntimeAnalytics } from '@ethivia/vacp-analytics';
import { createPosthogProvider } from '@ethivia/vacp-analytics-posthog';

posthog.init(apiKey, { api_host: 'https://us.i.posthog.com', person_profiles: 'identified_only' });
const analytics = installVacpRuntimeAnalytics({ bridge: runtime, provider: createPosthogProvider(posthog) });
```

`createPosthogProvider(client)` maps the provider onto an initialized PostHog client's `capture`, `register_for_session`, and `startSessionRecording`. The application initializes PostHog once and reuses the client across runtimes.
