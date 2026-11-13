# @ethivia/vacp-sdk/inspector

These exports read a runtime or a Python application for a custom inspection surface. A session holds the request state and optional history, and an index answers lookups in one observation. The [Inspector guide](../inspector/) builds a complete surface.

```ts
import {
  connectHttpInspectorClient,
  createInspectionIndex,
  createInspectorSession,
  createRuntimeInspectorClient,
  type HttpInspectorOptions,
  type InspectionEntity,
  type InspectionIndex,
  type InspectionObservation,
  type InspectionRecord,
  type InspectionSnapshot,
  type InspectorAction,
  type InspectorActionState,
  type InspectorClient,
  type InspectorRequest,
  type InspectorRuntime,
  type InspectorSession,
  type InspectorSessionOptions,
  type InspectorState,
} from '@ethivia/vacp-sdk/inspector';
```

## createInspectorSession

```ts
function createInspectorSession(client: InspectorClient, options?: InspectorSessionOptions): InspectorSession;
type InspectorSessionOptions = { historyLimit?: number };
```

Creates a session for one [`InspectorClient`](#inspectorclient). Creating it and subscribing read nothing.

- `options.historyLimit`: the changed observations `records` keeps. Default: `0`.

Returns an [`InspectorSession`](#inspectorsession). Throws a `RangeError` when `historyLimit` is not a non-negative integer.

## InspectorSession

```ts
interface InspectorSession {
  readonly client: InspectorClient;
  getState(): InspectorState;
  subscribe(listener: () => void): () => void;
  start(): void;
  refresh(): Promise<void>;
  execute(call: VacpActionRequest, options?: { signal?: AbortSignal }): Promise<VacpActionResult>;
  restore(observation: InspectionObservation, options?: { signal?: AbortSignal }): Promise<VacpActionResult>;
  reveal(ref: VacpRef, options?: { signal?: AbortSignal }): Promise<void>;
  clearHistory(): void;
  dispose(): void;
}
```

- `client`: the client the session reads.
- `getState()`: the current [`InspectorState`](#inspectorstate), the same object until it changes.
- `subscribe(listener)`: notifies on state changes and returns a function that removes the listener. Listener failures are isolated.
- `start()`: reads the source and follows its invalidations. Later calls do nothing. A failed subscription sets `status` to `error`.
- `refresh()`: reads once. It replaces a read in progress, and a replaced read never publishes.
- `execute(call, options?)`: runs an action through the client and resolves with its result, then reads again. Rejects when the client has no `execute`, the current observation lists no action of that name, or another action is running.
- `restore(observation, options?)`: applies a recorded observation through the client's `restore`, then reads again. Rejects when the client has no `restore` or another action is running.
- `reveal(ref, options?)`: asks the client's host to show an entity. Rejects when the client has no `reveal`.
- `clearHistory()`: releases the retained records.
- `dispose()`: cancels requests, releases the subscription, and sets `status` to `disposed`. Later reads and actions throw or reject, and later `dispose()` calls do nothing.

Invalidations during a read schedule one more read after it settles.

## InspectorState

```ts
type InspectorState = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
  readonly observation: InspectionObservation | null;
  readonly observationError: Error | null;
  readonly records: readonly InspectionRecord[];
  readonly action: InspectorActionState;
};
```

`observation` keeps the last successful read while a later read loads or fails.

## InspectorAction

```ts
type InspectorAction =
  | { readonly kind: 'execute'; readonly call: InspectionSnapshot<VacpActionRequest> }
  | { readonly kind: 'restore'; readonly observation: InspectionObservation };
```

The action a session is running or last ran.

## InspectorActionState

```ts
type InspectorActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly action: InspectorAction }
  | {
      readonly status: 'complete';
      readonly action: InspectorAction;
      readonly result: InspectionSnapshot<VacpActionResult>;
    }
  | { readonly status: 'error'; readonly action: InspectorAction; readonly error: Error }
  | { readonly status: 'capture-error'; readonly action: InspectorAction; readonly error: Error };
```

`capture-error` means the action returned a result the session could not capture as JSON.

## InspectionSnapshot

```ts
type InspectionSnapshot<T> = T extends Date
  ? string | null
  : T extends object
    ? { readonly [Key in keyof T]: InspectionSnapshot<T[Key]> }
    : T;
type InspectionObservation = InspectionSnapshot<VacpObservation>;
type InspectionRecord = { readonly id: number; readonly observation: InspectionObservation };
```

A frozen, JSON-shaped copy of a value. A session captures plain records, arrays, strings, finite numbers, booleans, and `null`, and turns a `Date` into its JSON text. Any other value fails the capture.

## InspectorClient

```ts
interface InspectorClient {
  readonly id: string;
  readonly title: string;
  observe(options: InspectorRequest): Promise<VacpObservation>;
  execute?(call: VacpActionRequest, options: InspectorRequest): Promise<VacpActionResult>;
  subscribe?(invalidate: () => void): () => void;
  restore?: VacpRestore;
  reveal?(ref: VacpRef, options: InspectorRequest): void | Promise<void>;
}
type InspectorRequest = { signal: AbortSignal };
```

One analytical session. `observe` returns the complete catalog, including unavailable entities and actions. Each optional member adds the session function of the same name.

## createRuntimeInspectorClient

```ts
function createRuntimeInspectorClient(options: {
  id: string;
  title: string;
  runtime: InspectorRuntime;
  restore?: VacpRestore;
  reveal?: InspectorClient['reveal'];
}): InspectorClient;
```

Reads `runtime.inspect()`, executes through `runtime.execute`, and invalidates on each runtime snapshot.

- `id`, `title`: name the session in your interface.
- `runtime`: the `runtime` that `installVacpRuntime` returns, or a runtime from `createVacpRuntime`.
- `restore`: a [restoration function](./runtime#vacprestore), such as `createVacpRestorer(runtime)`. Default: none, and the session cannot restore.
- `reveal`: shows an entity in your application. Default: none, and the session cannot reveal.

## InspectorRuntime

```ts
type InspectorRuntime = {
  inspect(): Promise<VacpObservation>;
  execute(call: VacpActionRequest, options?: { signal?; actor?; narration?; restoration? }): Promise<VacpActionResult>;
  subscribeSnapshots(listener: () => void): () => void;
};
```

The part of a [`VacpRuntime`](./runtime#vacpruntime) a runtime client uses.

## connectHttpInspectorClient

```ts
function connectHttpInspectorClient(options: HttpInspectorOptions): Promise<InspectorClient>;
type HttpInspectorOptions = {
  url: string;
  fetch?: typeof globalThis.fetch;
  intervalMs?: number;
  signal?: AbortSignal;
};
```

Connects to a [Python inspection endpoint](./python#create-inspection-app). Reads the session identity from `/session` and sends it with every later request in the `X-VACP-Session` header.

- `url`: the endpoint's base URL.
- `fetch`: sets credentials, headers, or another transport. Default: `globalThis.fetch`.
- `intervalMs`: the polling interval while the session has subscribers. `0` turns polling off. Default: `1000`.
- `signal`: cancels the `/session` request.

Resolves to a client with `observe`, `execute`, and `subscribe`. Rejects for an invalid `intervalMs` with a `RangeError`, and for a failed `/session` request with `Inspection request failed (<status>): <body>`. Later requests reject with the same message, and with a [Zod](https://zod.dev) error for a response that is not a valid record.

## createInspectionIndex

```ts
function createInspectionIndex(observation: InspectionObservation): InspectionIndex;
```

Builds lookups for one observation. Build one index per observation you show. Throws when the graph's availability names a missing prerequisite or forms a cycle.

## InspectionIndex

- `observation`: the indexed observation.
- `availableActions`: the actions that can run.
- `entity(ref)`: an [`InspectionEntity`](#inspectionentity), or `undefined` for an unknown ref.
- `action(name)`: the `descriptor`, owning `source`, `availability`, and `prerequisites` of an action, or `undefined` for an unknown name.
- `source(id)`: the source description, or `undefined` for an unknown ID.

`availability` is `{ available, blockedBy, reason? }`, where `blockedBy` holds the direct prerequisites that are unavailable.

## InspectionEntity

- `node`: the graph node.
- `source`: the owning source description.
- `hasValue`: whether the observation holds state for the ref.
- `value`, `summary`, `freshness`: the ref's entries in the observation.
- `incoming`, `outgoing`: the edges that end and start at the ref.
- `actions`: the actions that require, read, change, or produce the ref.
- `availability`, `prerequisites`: the ref's availability and the nodes it requires.
- `dependents`: the nodes that require the ref.
