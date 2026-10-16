# @vacp/analytics-posthog

Forward VACP telemetry through a host-initialized [PostHog](https://posthog.com/docs/libraries/js) client.

```ts
import { posthog } from 'posthog-js';
import { installVacpRuntimeAnalytics } from '@vacp/analytics';
import { createPosthogProvider } from '@vacp/analytics-posthog';

posthog.init(apiKey, { api_host: apiHost });
const installation = installVacpRuntimeAnalytics({
  bridge: runtime,
  provider: createPosthogProvider(posthog),
  captureSnapshots: false,
});

installation.dispose();
```

The host owns client initialization and configuration. `createPosthogProvider(client)` maps event capture, session properties, and session recording to that client. Installing runtime analytics starts session recording and binds telemetry delivery to the runtime lifetime. Multiple runtimes can share one client.
