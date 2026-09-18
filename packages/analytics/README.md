# @vacp/analytics

Subscribe to runtime events and forward them to a `VacpAnalyticsProvider`. The provider supplies `capture` and optional session-property and recording operations.

```ts
import { installVacpRuntimeAnalytics } from '@vacp/analytics';

const installation = installVacpRuntimeAnalytics({ bridge, provider });
installation.cleanup();
```

Subscriptions use public runtime metadata. Reinstallation replaces the subscription for the same provider and event prefix. Cleanup stops pending capture and session updates.

Use `@vacp/analytics-posthog` for PostHog integration.
