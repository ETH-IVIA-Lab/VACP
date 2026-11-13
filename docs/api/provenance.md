# Provenance and replay

These exports read the runtime's provenance records: their checkpoints, who set a value, and a replay viewer. [`ProvenanceRecord`](./protocol#provenancerecord) describes each record kind. The [Provenance and replay guide](../provenance/) explains attribution and review.

```ts
import {
  createProvenanceReplay,
  provenanceAttribution,
  provenanceCheckpoints,
  type ProvenanceCheckpoint,
  type ProvenanceReplayController,
  type ProvenanceReplayState,
  type ProvenanceSource,
} from '@ethivia/vacp-sdk';
```

## ProvenanceSource

```ts
interface ProvenanceSource {
  getProvenance(): Snapshot;
  subscribeProvenance(listener: (event: Event) => void): () => void;
}
// Snapshot: { runtimeId: string; sessionKey?: string; epoch: number; revision: number; limit: number; records: readonly ProvenanceRecord[] }
// Event: { epoch: number; revision: number; record: ProvenanceRecord | null }
```

The provenance of a runtime or page bridge.

- `records`: the most recent retained records, at most `limit`.
- `revision`: the records captured in this `epoch`, including dropped ones. `revision > records.length` means the oldest records are gone.
- `epoch`: changes when a different `sessionKey` starts another provenance epoch.
- `Event.record`: `null` invalidates the previous epoch's recording, so a viewer drops what it showed from it.

## provenanceCheckpoints

```ts
function provenanceCheckpoints(records: readonly ProvenanceRecord[]): ProvenanceCheckpoint[];
```

Projects records into analytical checkpoints, oldest first. It compares state across the whole chronology, and skips queries, restorations, intermediate concurrent observations, and consecutive identical states.

## ProvenanceCheckpoint

```ts
type ProvenanceCheckpoint = {
  id: string;
  record: ProvenanceRecord;
  observation: VacpObservation;
  position: 'before' | 'after';
};
```

A `before` checkpoint is the state an action started from. Its metadata stays on `record`.

## provenanceAttribution

```ts
function provenanceAttribution(
  journal: { records: readonly ProvenanceRecord[]; revision: number },
  ref: VacpRef,
): ProvenanceRecord | 'unchanged' | 'unknown';
```

Returns the retained record that set the current value of `state[ref]` in the current session, for example `provenanceAttribution(runtime.getProvenance(), ref)`. It reads records oldest first and compares each captured state with the state captured before it:

- An `external` observation owns a change from the previous captured state.
- An action that reached its effects owns a change its own `before` and result show. Its phase can be `succeeded`, `failed`, or `cancelled`.
- Records that finish while an action runs come before it in `journal.records`, so the order does not show whether an action's `before` was captured before or after the current value. An action that ends on the current value takes it over only when no record owns it. When a record set the value, either could have made it, so the value is `unknown` until a record captures a different change.
- A change shown by a query or by an action rejected before its effects has no owner. It is `unknown` until an action that ends on it, or a restoration that captures the same transition, takes it over. A `before` that differs from the current captured value has unknown ownership, including when earlier records show the same transition.
- A restoration gives each value it restores back to the owner the ref had when it last held that value. A restoration that captures the same transition as another record contests only an observation's change, and an action owns a change it captures along with a restoration. Restorations capturing the same transition preserve earlier ownership when their `beforeCaptureId` matches, and a missing `beforeCaptureId` leaves a differing `before` unknown. When no retained record held the value, the answer is one of the restoration's `vacp.apply_state` records, or `unknown` when records of the session were dropped.
- A `concurrent` observation is deferred to later listed execution records when every listed execution has a retained record and a later one captures the ref's value in its `before` or result. Intermediate values those records never capture count as `unknown`, including a value equal to the current one. While a listed execution has no retained record, the change the observation shows is `unknown`. When every listed record precedes the observation, it counts as `external`.
- An action that reached its effects without a captured result makes the next change an observation shows `unknown`, and every ref `unknown` while no capture follows it. An action without a captured result whose `before` shows another value than the current one does the same for that ref, and keeps the current value `unknown` until a capture shows a change.
- Turns are skipped. A `session` record starts the comparison over.

Returns `unchanged` when no record of the session set the ref's current value, counting the first captured state of a session as its baseline. Returns `unknown` when no record owns the current value, or when the change that set it may lie before the oldest retained record (`revision > records.length`). Records arrive as actions finish, so the record of a running action can still change the answer.

## createProvenanceReplay

```ts
function createProvenanceReplay(runtime: Source, options: { restore: VacpRestore }): ProvenanceReplayController;
// Source: ProvenanceSource & VacpExecutionSource & Pick<VacpPageBridge, 'inspect'>
```

Creates one viewer's replay over the runtime's provenance.

- `options.restore`: applies a checkpoint's state, such as `createVacpRestorer(runtime)`. Required.

Returns a [`ProvenanceReplayController`](#provenancereplaycontroller). Throws when the runtime is disposed.

## ProvenanceReplayController

```ts
interface ProvenanceReplayController {
  getState(): ProvenanceReplayState;
  subscribe(listener: () => void): () => void;
  review(checkpointId: string): Promise<void>;
  close(): Promise<void>;
  interrupt(): void;
  dispose(): void;
}
```

- `getState()`: the current [`ProvenanceReplayState`](#provenancereplaystate), the same object until it changes.
- `subscribe(listener)`: notifies when the state changes and returns a function that removes the listener.
- `review(checkpointId)`: restores the checkpoint. The first review saves the live state to return to. Rejects for an unknown checkpoint ID.
- `close()`: restores the saved live state and returns to `live`.
- `interrupt()`: ends review and cancels pending restoration without restoring the saved state.
- `dispose()`: cancels pending work and releases subscriptions without restoring anything. `subscribe`, `review`, `close`, and `interrupt` then throw or reject.

## ProvenanceReplayState

```ts
type ProvenanceReplayState = {
  checkpoints: readonly ProvenanceCheckpoint[];
  turns: readonly VacpTurnRecord[];
  selected: ProvenanceCheckpoint | null;
  latest: ProvenanceCheckpoint | null;
  working: boolean;
} & ({ phase: 'live' | 'restoring' | 'reviewing' } | { phase: 'error'; error: string });
```

- `checkpoints`: the checkpoints of the current session. Outside `live`, `checkpoints` and `turns` stay as they were when review began.
- `turns`: the finished agent turns of the session, oldest first.
- `selected`: the checkpoint being restored or reviewed.
- `latest`: the latest checkpoint, before any viewer's filter.
- `working`: `true` from the moment an execution that changes the analysis is prepared until its record reaches `checkpoints`. Queries and this viewer's own restorations leave it `false`.
- `phase`: `error` means a restoration failed, and `error` holds its message.

A review request made while `working` is true, or while another review runs, is declined, and the viewer asks again once the work settles. A later change by another actor, a changed external observation, or another session ends the review and keeps the state that change produced.
