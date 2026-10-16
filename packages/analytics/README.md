# @vacp/analytics

Forward a runtime's provenance records to a `VacpAnalyticsProvider`.

```ts
import { installVacpRuntimeAnalytics } from '@vacp/analytics';

const installation = installVacpRuntimeAnalytics({ bridge: runtime, provider });
installation.dispose();
```

Each installation owns its subscription and pending delivery. Calling `dispose()` or aborting the runtime's lifetime signal stops both. Event names start with `vacp_`. Session properties retain the latest 50 records and flush at most once per second.

Pass `captureSnapshots: true` to include analytical state and observation events. Observation delivery keeps the latest snapshot within each one-second interval. `getBaseProperties` adds application properties to events and session updates.

Use `@vacp/analytics-posthog` to connect a host-initialized [PostHog](https://posthog.com/docs/libraries/js) client, which sends telemetry to the host's configured endpoint.
