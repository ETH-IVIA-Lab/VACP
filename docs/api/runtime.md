# Runtime and page bridge

The runtime composes providers into one graph, executes actions, records provenance, and publishes agent activity. `installVacpRuntime` creates one in a page and publishes it as the page bridge, which [`getVacpBridge`](./agent#getvacpbridge) reads. `createVacpRuntime` creates one in any JavaScript environment.

```ts
import {
  createVacpRestorer,
  createVacpRuntime,
  installVacpRuntime,
  vacpAgentActor,
  vacpHumanActor,
  type VacpActor,
  type VacpAgentActivityHandle,
  type VacpExecutionControl,
  type VacpExecutionSource,
  type VacpPageBridge,
  type VacpRestorationResult,
  type VacpRestore,
  type VacpRuntime,
} from '@ethivia/vacp-sdk';
```

## installVacpRuntime

```ts
function installVacpRuntime(options: {
  providers: readonly VacpProvider[];
  exposeBridge: boolean;
  injectDomSnapshot?: boolean;
  sessionKey?: string;
  globalKey?: string;
  runtimeId?: string;
}): { runtime: VacpRuntime; dispose(): void };
```

Installs one runtime per `globalKey` and attaches `providers` to it.

- `providers`: required. The [providers](./actions#vacpprovider) this installation attaches.
- `exposeBridge`: required. `true` publishes the runtime at `window[globalKey]`. `false` keeps it reachable through the returned `runtime` alone.
- `injectDomSnapshot`: defaults to `false`. `true` writes each observation into `application/json` script elements, described in [DOM snapshot](#dom-snapshot).
- `sessionKey`: names the analytical session. A key that differs from the installed runtime's replaces every source and starts another provenance epoch.
- `globalKey`: the `window` property of the bridge, and the key installations share. Default: `'__vacp'`.
- `runtimeId`: the runtime's identity. Default: a random ID.

A second installation at the same `globalKey` reuses the runtime. Providers with other source IDs join it, and a provider with an attached source ID replaces that source.

Returns the `runtime` and `dispose()`. `dispose()` detaches the providers this installation attached. When no provider remains, it disposes the runtime and removes the bridge and the snapshot scripts. Later calls do nothing.

## createVacpRuntime

```ts
function createVacpRuntime(options: {
  providers: readonly VacpProvider[];
  sessionKey?: string;
  runtimeId?: string;
  historyLimit?: number;
}): VacpRuntime;
```

Composes `providers` into one runtime and subscribes to their invalidations.

- `providers`: required. Each source ID appears once.
- `sessionKey`: names the analytical session.
- `runtimeId`: the runtime's identity. Default: a random ID.
- `historyLimit`: the provenance records the runtime keeps. Past it, the oldest record drops. Default: `256`.

Returns a [`VacpRuntime`](#vacpruntime). Throws when two providers share a source ID, and a `RangeError` when `historyLimit` is not a positive integer.

## VacpRuntime

```ts
interface VacpRuntime extends VacpPageBridge, VacpExecutionControl {
  readonly signal: AbortSignal;
  readonly providerIds: readonly string[];
  attachProviders(providers: readonly VacpProvider[]): () => void;
  getProviderBinding(provider: VacpProvider): { id: string; signal: AbortSignal };
  update(next: { providers: readonly VacpProvider[]; sessionKey?: string }): void;
  getAgentActivities(): readonly AgentActivity[];
  subscribeAgentActivities(listener: (activity: AgentActivity) => void): () => void;
  subscribeCapabilities(listener: (snapshot: VacpCapabilitiesSnapshot) => void): () => void;
  subscribeSnapshots(
    listener: (snapshots: {
      observation: VacpObservation;
      capabilities: VacpCapabilitiesSnapshot;
      state: VacpStateSnapshot;
    }) => void,
  ): () => void;
  dispose(): void;
}
// AgentActivity: { id; actor: VacpActor; phase: 'thinking' | 'completed' | 'failed' | 'cancelled'; summary?; at }
```

The runtime holds the members of [`VacpPageBridge`](#vacppagebridge) and [`VacpExecutionControl`](#vacpexecutioncontrol), plus these:

- `signal`: aborts on `dispose()`.
- `providerIds`: the attached source IDs.
- `attachProviders(providers)`: adds sources, or replaces attached ones with the same source ID, in one step. Returns a function that detaches the sources this call attached and still owns. Throws when `providers` repeats a source ID.
- `getProviderBinding(provider)`: the provider's current attachment. Replacing or detaching the provider aborts `signal`, and the next attachment has another `id`. Throws when the provider is not attached.
- `update({ providers, sessionKey? })`: replaces every source. A `sessionKey` that differs from the current one cancels running executions, clears agent activity, and starts another provenance epoch with a `session` record.
- `getAgentActivities()`: each actor's open or last turn.
- `subscribeAgentActivities(listener)`: receives every turn change.
- `subscribeCapabilities(listener)`: receives the capabilities snapshot when the graph changes.
- `subscribeSnapshots(listener)`: receives the observation, capabilities, and state after each read that changed.
- `dispose()`: cancels pending calls, releases subscriptions, and disposes the attached providers. Later calls do nothing.

Each `subscribe*` function returns a function that removes the listener.

## VacpPageBridge

```ts
interface VacpPageBridge extends VacpExecutionSource, ProvenanceSource, VacpAgentActivityControl {
  readonly version: '0.1.0';
  readonly runtimeId: string;
  readonly sessionKey: string | undefined;
  observe(): Promise<VacpObservation>;
  inspect(): Promise<VacpObservation>;
  getCapabilities(request?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot>;
  getState(request?: VacpStateRequest): Promise<VacpStateUpdate>;
  execute(call: VacpActionRequest, options?: { signal?; actor?; narration?; restoration? }): Promise<VacpActionResult>;
  record(options?: { actor?: VacpActor; message?: string; focus?: VacpFocus }): Promise<VacpStateSnapshot>;
}
```

The runtime as a page publishes it at `window.__vacp`. It adds [provenance](./provenance#provenancesource), [agent activity](./agent#vacpagentactivitycontrol), and [executions](#vacpexecutionsource) to these members:

- `observe()`: one [observation](./protocol#vacpobservation) of the nodes and actions available at the time of the read, with state, summaries, and freshness.
- `inspect()`: the complete catalog, including unavailable nodes and actions. Execution still checks current availability.
- `getCapabilities(request?)`: the graph, scoped by a [`VacpCapabilitiesRequest`](./agent#vacpcapabilitiesrequest). A scoped read keeps the transitive prerequisites of matching nodes. `includeActions`, `includeEdges`, and `includeNodeData` default to `true`.
- `getState(request?)`: a [`VacpStateUpdate`](./protocol#vacpstateupdate). Without `since`, or with a token the runtime does not hold, it is `mode: 'full'` with a `token`. With a held token, it is `mode: 'delta'` with the changes since that read.
- `execute(call, options?)`: runs one action, described below.
- `record(options?)`: reads the sources and records the result as an external observation by `actor`, the system actor by default. Call it after a person changes the application.

### execute

`execute` routes the call to the source that owns the action, checks availability, prepares the call, waits for [execution gates](#vacpexecutioncontrol), checks availability again, and executes once. It records one provenance record once the result is known.

- `call.callId`: kept as written. The runtime assigns one when it is absent, null, or blank. The result, execution, and record carry it.
- `options.actor`: the actor the call is attributed to. Default: [`vacpAgentActor`](#actors).
- `options.narration`: the step's sentence for the person watching, at most 280 code points.
- `options.signal`: cancels the call. Aborting before execution prevents the change. Changes already applied stay.
- `options.restoration`: `{ id, entryId? }` marks a call that restores recorded state. Restoring calls belong to no agent turn.

Resolves to `{ ok: false }` for an unknown or unavailable action, invalid parameters, or a handler failure. An availability failure carries `details.code`: `unknown-action`, `action-unavailable`, or `input-unavailable`. Throws a `TypeError` for a `callId` that is neither a string nor null, or for an unusable `narration`. Rejects with the abort reason when the call is cancelled.

### Agent activity

`beginAgentActivity` and `narrate` publish an agent's public progress as turns. Their signatures are on [`VacpAgentActivityControl`](./agent#vacpagentactivitycontrol).

- `beginAgentActivity({ actor, summary?, signal? })`: opens a turn and returns a [`VacpAgentActivityHandle`](#vacpagentactivityhandle). The turn stays open until the handle ends it, or `signal` aborts.
- `narrate({ actor, message, done?, signal? })`: speaks one sentence. It joins the actor's open turn or opens one. Later sentences replace its words, and `done: true` closes it.
- An agent's first execution with no open turn opens one, so the steps of one request share an `activityId`.
- A turn that `narrate` or a step opened closes after 60 seconds without a sentence or a step, once the actor has no execution in flight.
- A summary is at most 500 code points. The runtime keeps 32 actors with an open turn at most, and opening a 33rd cancels the oldest.

## VacpAgentActivityHandle

```ts
type VacpAgentActivityHandle = {
  update(summary: string): void;
  end(options?: { outcome?: 'completed' | 'failed' | 'cancelled'; summary?: string }): void;
};
```

Controls one turn opened by `beginAgentActivity`. `update` replaces the turn's words. `end` closes it with `outcome`, `completed` by default, and keeps the last summary unless it receives one. A handle of a closed turn does nothing.

## VacpExecutionSource

```ts
interface VacpExecutionSource {
  readonly signal: AbortSignal;
  getActiveExecutions(): readonly VacpExecution[];
  subscribeExecutions(listener: (execution: VacpExecution) => void): () => void;
}
```

Publishes each [`VacpExecution`](./protocol#vacpexecution) phase. `getActiveExecutions()` returns the executions that have not settled, so a late subscriber sees work already in flight.

## VacpExecutionControl

```ts
interface VacpExecutionControl {
  readonly signal: AbortSignal;
  addExecutionGate(
    gate: (execution: VacpExecution, signal: AbortSignal) => void | Promise<void>,
    options: { timeoutMs: number; stage?: 'before' | 'after' },
  ): () => void;
}
```

Adds a bounded wait to every execution, such as presence [pacing](./presence#paceagentpresence).

- `gate`: runs for each execution. `signal` aborts when the wait ends.
- `options.timeoutMs`: the longest wait in milliseconds. Required, finite, and at least 0.
- `options.stage`: `before` runs between preparation and execution. `after` runs once the result is known and never changes it. Default: `'before'`.

Returns a function that removes the gate. Throws for an invalid `timeoutMs` or a gate already added.

## DOM snapshot

With `injectDomSnapshot: true`, the runtime writes each observation into `application/json` script elements. The base script's ID is `<globalKey>_snapshot`, `__vacp_snapshot` by default, and it holds a `vacp.dom_snapshot` manifest that links the other scripts by ID.

| Script        | `data-vacp`              | Contents                                                                                       |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| Manifest      | `snapshot`               | `observation.revision`, sources, freshness, and the IDs of the graph, state index, and catalog |
| Graph         | `snapshot-graph`         | Nodes, edges, and actions, with a `token` that changes with the graph                          |
| State catalog | `snapshot-state-catalog` | One entry per ref with its `scriptId`, kind, layer, and title, and a `token` for the catalog   |
| State index   | `snapshot-state-index`   | `revision`, `baseRevision`, `changedRefs`, `removedRefs`, and whether the catalog changed      |
| Ref           | `snapshot-ref`           | One ref's `value` and optional `summary`                                                       |

Every script carries `data-vacp-root` with the base script ID. Each ref script carries `data-vacp-snapshot-ref` with its ref.

The runtime writes when the observation revision or the graph changes. Unchanged refs keep their script text, and the graph and catalog scripts change only when their content does. The state index names the revision it describes and, after the first write, the revision written before it:

- A reader at `baseRevision` reaches `revision` by rereading the ref scripts in `changedRefs` and dropping those in `removedRefs`. When `catalog.changed` is true, it rereads the catalog first to find the scripts of added refs.
- A write at the same revision, such as after a graph change that leaves state alone, has `baseRevision` equal to `revision` and empty lists.
- A reader at any other revision rereads the catalog and every ref script it lists.

## createVacpRestorer

```ts
function createVacpRestorer(
  runtime: Pick<VacpPageBridge, 'inspect' | 'execute'> & { readonly signal: AbortSignal },
): (
  state: Readonly<Record<VacpRef, unknown>>,
  options?: { signal?; actor?; narration?; restoration? },
) => Promise<VacpRestorationResult>;
```

Returns a [`VacpRestore`](#vacprestore) that restores a state keyed by ref through each owning source's `vacp.apply_state` action. Each call reads ownership with `inspect()`, then executes each source's share of `state`. Calls to one returned function run one at a time.

- `options.actor`: the actor of each call. Default: [`vacpHumanActor`](#actors).
- `options.restoration`: marks the calls as restorations. Default: `{ id }` with one ID per call.
- `options.signal`: cancels the request together with the runtime's `signal`.

Every ref must belong to a source with exactly one `vacp.apply_state` action, checked before any source changes. After the check, sources restore independently, and the call waits for all of them.

Resolves to a [`VacpRestorationResult`](#vacprestorationresult). A failed check resolves to `{ ok: false, error: { message } }` and applies nothing. Rejects when `options.signal` or the runtime aborts.

## VacpRestorationResult

```ts
type VacpRestorationResult =
  | { callId: string; ok: true; result: { sources: Outcome[] } }
  | { callId: string; ok: false; error: { message: string; details?: { sources: Outcome[] } } };
// Outcome: { sourceId: VacpSourceId; action: string; result: VacpActionResult }
```

One `Outcome` per source that the restoration called. A failure in any source fails the whole result, with every source's outcome in `details.sources`.

## VacpRestore

```ts
type VacpRestore = (
  state: Readonly<Record<VacpRef, unknown>>,
  options: { signal?; actor?; narration?; restoration? },
) => Promise<VacpActionResult>;
```

The restoration function [`createProvenanceReplay`](./provenance#createprovenancereplay) and [inspector clients](./inspector#inspectorclient) accept, such as `createVacpRestorer(runtime)`.

## Actors

```ts
type VacpActor = { id: string; kind: 'agent' | 'human' | 'system'; label?: string };
const vacpAgentActor: VacpActor; // { id: 'agent', kind: 'agent' }
const vacpHumanActor: VacpActor; // { id: 'human', kind: 'human' }
```

A `VacpActor` names who made a change. The host supplies it beside the call, never inside an action's parameters. `label` replaces the name a viewer gives the actor's `kind`, such as the presence overlay's [`labels`](./overlay#labels).

`vacpAgentActor` is the actor every agent transport and `execute` use when the host names none. `vacpHumanActor` is the actor of restorations and replay. Both are frozen.
