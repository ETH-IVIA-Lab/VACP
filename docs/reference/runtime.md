# Runtime

`@vacp/runtime` adds history, replay, subscriptions, and state deltas to snapshot and action providers. It runs independently of the browser.

```ts
import { createVacpRuntime } from '@vacp/runtime';

const runtime = createVacpRuntime({ snapshots, actions, sessionKey: 'overview' });
const state = await runtime.getState();
```

`snapshots` implements `VacpSnapshotProvider`:

- `getCapabilities()` returns a capabilities snapshot, synchronously or asynchronously.
- `getState()` returns a state snapshot, synchronously or asynchronously.

`actions` implements `VacpActionExecutor`:

- `list()` returns action descriptors.
- `execute(call)` returns a promise of an action result.

`VacpActionRegistry` implements this port and provides `register(descriptor, handler)` and `unregister(name)`. Custom registries can implement the same port. The runtime does not require this class.

## History and state

`getRuntime()` returns the current mode, cursor, history, live snapshots, and inspected snapshots. `subscribe(listener)` receives runtime entries and returns an unsubscribe function.

`refresh({ source, message })` records a snapshot after an application change. `setCursor(index)`, `undo()`, and `redo()` inspect history. When the provider exposes `vacp.apply_state`, inspection can replay recorded state into the application. `setMode('live')` restores the latest live state.

State and graph overrides affect inspection. They reach the application only through an explicit action.

## Provider replacement and lifecycle

`update({ snapshots, actions, sessionKey })` replaces provider ports while retaining runtime identity. A changed session key resets the history for the new view. Public `runtimeId` and `sessionKey` properties identify the current runtime and session.

`dispose()` stops observation, clears subscriptions, and cancels queued replay work. Release a browser installation with [`uninstallVacpRuntime`](./browser).

## Standard actions

The registration helpers accept a `VacpActionRegistrar`, which supplies `register(descriptor, handler)`:

- `registerVacpApplyStateAction`
- `registerVacpDataSchemaAction`
- `registerVacpDataSqlAction`
- `registerVacpWidgetOptionsAction`

`registerVacpDataSqlAction(registrar, handler, { enabled: false })` skips SQL registration. Browser integrations resolve browser policy before passing this option.
