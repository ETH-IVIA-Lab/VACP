# Browser adapter

`@vacp/runtime-browser` owns bridge installation, discovery, browser configuration, and DOM snapshot publication.

```ts
import { installVacpRuntime, getVacpBridge, uninstallVacpRuntime } from '@vacp/runtime-browser';

const runtime = installVacpRuntime({ snapshots, actions, sessionKey: 'overview' });
const bridge = getVacpBridge();

uninstallVacpRuntime();
```

`snapshots` and `actions` implement the [runtime ports](./runtime). Installation returns the runtime and exposes it at `window.__vacp` by default. Reinstallation at the same key preserves runtime identity and updates its provider ports.

Pass `globalKey` to each operation to use a different key. `getVacpBridge()` returns `undefined` when exposure is disabled, the protocol version differs, or a required bridge method is missing.

`injectDomSnapshot` controls publication of JSON snapshots in script elements. `domSnapshotScriptId` overrides the base script ID. With bridge exposure disabled, the runtime remains available to the installing application while its window globals are removed.

`uninstallVacpRuntime()` disposes the runtime and removes its bridge and DOM snapshots.

## Configuration

`getVacpBrowserOptions()` returns effective option values. `getVacpBrowserOptionResolution()` also reports each value's source. `setVacpBrowserOptionOverride(key, value)` and `clearVacpBrowserOptionOverride(key)` edit browser-storage overrides.

See [configuration](./configuration) for flags and precedence.
