# @vacp/analytics

Optional analytics integrations for VACP apps.

## PostHog (browser)

This integration uses the official `posthog-js` SDK and streams VACP runtime history into PostHog events + session replay properties.

```ts
import { installVacpPosthogAnalytics } from '@vacp/analytics';

const apiKey = import.meta.env.VACP_POSTHOG_API_KEY;
if (apiKey) {
  installVacpPosthogAnalytics({
    bridge,
    posthog: {
      apiKey,
      apiHost: import.meta.env.VACP_POSTHOG_API_HOST, // e.g. https://us.i.posthog.com or your self-hosted instance
    },
    analytics: {
      // Off by default to avoid spamming analytics during brush/drag interactions.
      // When enabled, snapshots are throttled to about one per second.
      captureSnapshots: true,
    },
  });
}
```

By default this:

- starts PostHog session recording (if available)
- captures VACP runtime history entries as PostHog events
- mirrors a bounded history buffer into session properties for replay

Snapshots are opt-in via `analytics.captureSnapshots` and are throttled to at most one snapshot per second by default.

In the repo examples, PostHog is enabled via:

- `VACP_POSTHOG_API_KEY` (required)
- `VACP_POSTHOG_API_HOST` (optional)
- `VACP_POSTHOG_DEFAULTS` (optional, forwarded to `posthog.init({ defaults })`)
- `VACP_POSTHOG_CAPTURE_SNAPSHOTS=1` (optional, enables snapshot capture)
