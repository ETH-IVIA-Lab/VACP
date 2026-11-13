# @ethivia/vacp-posthog

Sends a runtime's [provenance](../provenance/) records to [PostHog](https://posthog.com), a product analytics service, as events.

```bash
pnpm add @ethivia/vacp-posthog posthog-js
```

`@ethivia/vacp-sdk` is also a peer dependency. [Install](../install/) adds it.

## installVacpPosthog

```ts
installVacpPosthog(runtime: VacpRuntime, posthog: PostHog, options?: VacpPosthogOptions): { dispose(): void }
```

Captures a `vacp_runtime_init` event, and then captures one `vacp_<kind>` event per action, turn, and session record. Each event carries the record's actor, action, and outcome, along with `vacp_version`, `vacp_runtime_id`, and `vacp_session_key`.

```ts
import { posthog } from 'posthog-js';
import { installVacpPosthog } from '@ethivia/vacp-posthog';

posthog.init(apiKey, { api_host: 'https://us.i.posthog.com', person_profiles: 'identified_only' });
const telemetry = installVacpPosthog(runtime, posthog, { properties: () => ({ app: 'cars' }) });
```

`apiKey` is your PostHog project key, and `runtime` comes from `const { runtime } = installVacpRuntime(...)`.

- `runtime` is the runtime to observe.
- `posthog` is an initialized PostHog client. Your app initializes it once and can reuse it across runtimes. Call its `startSessionRecording()` to record the page.
- `options.properties` returns properties to add to every event, such as application and view IDs. PostHog reads it at capture time.
- `options.captureSnapshots` adds each action's before and after state to its event, and also sends observation records, at most one event a second. Defaults to `false`.

The function also registers the latest 50 records as the `vacp_history` session property, at most once a second. It catches exceptions from PostHog and from `properties`, so a telemetry failure cannot fail an action.

Returns `{ dispose }`. `dispose()` stops sending events and cancels pending deliveries, and disposing the runtime does the same. Throws when the runtime is already disposed.
