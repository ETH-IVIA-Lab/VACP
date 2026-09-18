# @vacp/analytics-posthog

Forward VACP runtime events and session metadata to PostHog through the telemetry provider contract.

```ts
import { installVacpPosthogAnalytics } from '@vacp/analytics-posthog';

const installation = installVacpPosthogAnalytics({
  bridge,
  posthog: { apiKey, apiHost },
});

installation.cleanup();
```

Configure snapshot capture and recording through the `analytics` options. Telemetry is installed by the application and sends data to its configured PostHog endpoint.
