# Connect a custom visualization

Use `@vacp/sdk` to describe your application's state and register actions against its existing controls. Each action handler updates application state. Each snapshot reads that same state.

This example exposes a numeric threshold control. Start with an input:

```html
<input id="threshold" type="range" min="0" max="100" value="10" />
```

Create the integration:

<<< ../../examples/custom-integration/threshold.ts

Connect the input after it has mounted:

```ts
import { connectThreshold } from './threshold';
import { installVacpInspector } from '@vacp/inspector';

const input = document.querySelector<HTMLInputElement>('#threshold')!;
const integration = connectThreshold(input);
const inspector = installVacpInspector();

await integration.bridge.execute({
  callId: 'set-threshold',
  name: 'threshold.set',
  params: { value: 42 },
});
```

The input now shows `42`. Human input and agent actions share the input's value. The capabilities graph lists `threshold.set`, and its state is available under `vacp://example/threshold`.

## Choose stable references

Derive refs from domain identities such as view IDs, parameter names, or dataset names. Keep the same ref when a chart rerenders. Use `createVacpRefBuilder({ appId, viewId, vizId })` when several entities share a namespace.

## Validate actions

`params(description, parser)` accepts a hand-written input description and an optional parser. Zod 4 schemas work directly, as does any object with a `parse(value)` method. The parser's return type becomes the handler's parameter type. Validation runs before the handler; thrown errors become unsuccessful action results.

Without a parser, the handler receives unvalidated input and owns validation. Action names and description fields are open to application-defined extensions. VACP does not generate schemas.

## Preserve application types

Action handlers can return ordinary interfaces, including nested objects and async results. Snapshot getters retain their state and summary types:

```ts
import { createVacpSnapshotProvider } from '@vacp/sdk';

const snapshots = createVacpSnapshotProvider({
  graph,
  actions: actions.registry,
  getState: () => ({ 'vacp://example/threshold': { value: 42 } }),
});

const snapshot = await snapshots.getState();
snapshot.state['vacp://example/threshold'].value; // number
```

Use `VacpActionCall<Params>`, `VacpActionResult<Result>`, and `VacpStateSnapshot<State, Summary>` when naming your own contracts. Node metadata stays typed through `VacpGraph<NodeData>` and `VacpCapabilitiesSnapshot<NodeData>`. No index signatures are needed on application interfaces. Transport input remains unvalidated until its receiver checks it. Keep transported payloads JSON-serializable.

The standard action helpers validate their common envelopes. Providers still validate the domain-specific values they apply.

## Refresh and cleanup

Call `integration.refresh(source, message)` after a human interaction changes state. Runtime subscriptions can also observe changes through periodic snapshots.

When the application unmounts, release its resources:

```ts
inspector?.dispose();
integration.dispose();
```

For direct control over snapshots and action execution, use the [runtime ports](../reference/runtime).
