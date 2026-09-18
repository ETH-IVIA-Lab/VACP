# Browser adapter

`@vacp/runtime-browser` installs a composed runtime, exposes its bridge, and publishes DOM observations.

```ts
import { getVacpBridge, installVacpRuntime } from '@vacp/runtime-browser';

const installation = installVacpRuntime({ providers: [controls, chart], sessionKey: 'overview' });
const runtime = installation.runtime;
const bridge = getVacpBridge();

installation.dispose();
```

Installing a provider with a new source ID adds it to the runtime. Installing the same source ID replaces its binding. A changed `sessionKey` replaces the full source set and starts a new history boundary.

`getVacpBridge()` returns `undefined` when no bridge is exposed, the protocol version differs, or a required method is missing. `bridge.observe()` reads the current composed observation.

`injectDomSnapshot` controls JSON publication in script elements. `domSnapshotScriptId` overrides the base script ID. With bridge exposure disabled, the runtime remains available to its installing application.

`uninstallVacpRuntime()` disposes every provider attached to that global key and removes the bridge and DOM observation scripts.

## Configuration

Pass `exposeBridge` and `injectDomSnapshot` directly to `installVacpRuntime`. Install the Inspector separately at the application boundary.

See [configuration](./configuration) for flags and precedence.
