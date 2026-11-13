# @ethivia/vacp-posthog

Sends the VACP runtime's provenance records to [PostHog](https://posthog.com), a product analytics service, as `vacp_*` events. Your application initializes the PostHog client and owns its configuration.

```bash
pnpm add @ethivia/vacp-sdk @ethivia/vacp-posthog posthog-js zod
```

`runtime` comes from `installVacpRuntime`, and `apiKey` is your PostHog project key:

```ts
import posthog from 'posthog-js';
import { installVacpPosthog } from '@ethivia/vacp-posthog';

posthog.init(apiKey, { api_host: 'https://us.i.posthog.com' });
const telemetry = installVacpPosthog(runtime, posthog);

// To stop sending:
telemetry.dispose();
```

`installVacpPosthog` also registers the runtime's recent history as session properties. Call PostHog's own `posthog.startSessionRecording()` to record the page. Events leave out analytical state and observation records unless you pass `captureSnapshots: true`. Pass `properties` to add your own properties to every event.

- [`@ethivia/vacp-posthog` reference](https://docs.vacp.dev/api/posthog)

## License

Apache-2.0
