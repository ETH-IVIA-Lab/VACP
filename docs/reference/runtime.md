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

`update({ snapshots, actions, sessionKey })` replaces provider ports while retaining runtime identity. Replacing the provider aborts pending calls from the previous provider. A changed session key resets the history for the new view. Public `runtimeId` and `sessionKey` properties identify the current runtime and session.

`dispose()` aborts the runtime's `signal`, stops observation, clears subscriptions, and cancels queued replay work. Extensions can use this signal to release resources. `subscribeCapabilities(listener)` observes live graph changes independently of history and inspection overrides. `subscribeSnapshots(listener)` supplies live capability/state pairs for output adapters such as DOM publication. Reads and actions on a disposed runtime reject. Release a browser installation with [`uninstallVacpRuntime`](./browser).

## Standard actions

The registration helpers accept a `VacpActionRegistrar`, which supplies `register(descriptor, handler)`:

- `registerVacpApplyStateAction`
- `registerVacpDataSchemaAction`
- `registerVacpDataSqlAction`
- `registerVacpWidgetOptionsAction`

`registerVacpDataSqlAction(registrar, handler, { enabled: false })` skips SQL registration. Browser integrations resolve browser policy before passing this option.

## Execution context

`execute(call, { signal })` and `dispatch(call, { source, message, signal })` enter live mode before applying an action. This behavior belongs to the runtime, so every transport follows the same history and replay rules.

Registry and SDK handlers receive `(params, { signal })`. Use the signal for cooperative cancellation. It combines the caller's cancellation with the runtime lifetime. The signal is an in-process control and is not serialized into `VacpActionCall`.
