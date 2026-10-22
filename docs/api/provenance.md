# @ethivia/vacp-provenance

Checkpoints, value attribution, and replay over the runtime's provenance journal. The [Provenance and replay guide](../provenance/) explains attribution, projection, and review.

## provenanceCheckpoints

```ts
provenanceCheckpoints(records: readonly VacpProvenanceRecord[]): ProvenanceCheckpoint[]
type ProvenanceCheckpoint = { id: string; record: VacpProvenanceRecord; observation: VacpObservation; position: 'before' | 'after' };
```

Projects records into analytical checkpoints, oldest first. It compares state across the whole chronology, and skips queries, restorations, intermediate concurrent observations, and consecutive identical states. A `before` checkpoint is the state an action started from. Its metadata stays on `record`.

## provenanceAttribution

```ts
provenanceAttribution(
  journal: Pick<VacpProvenanceSnapshot, 'records' | 'revision'>,
  ref: VacpRef,
): VacpProvenanceRecord | 'unchanged' | 'unknown'
```

Returns the retained record that set the current value of `state[ref]` in the current session, for example `provenanceAttribution(runtime.getProvenance(), ref)`. It reads records oldest first and compares each captured state with the state captured before it:

- An `external` observation owns a change from the previous captured state.
- An action that reached its effects owns a change its own `before` and result show. Its phase can be `succeeded`, `failed`, or `cancelled`.
- Records that finish while an action runs come before it in the journal, so the journal does not show whether an action's `before` was captured before or after the current value. An action that ends on the current value takes it over only when no record owns it. When a record set the value, either could have made it, so the value is `unknown` until a record captures a different change.
- A change shown by a query or by an action rejected before its effects has no owner. It is `unknown` until an action that ends on it, or a restoration that captures the same transition, takes it over. A `before` that differs from the current captured value has unknown ownership, including when earlier records show the same transition.
- A restoration gives each value it restores back to the owner the ref had when it last held that value. A restoration that captures the same transition as another record contests only an observation's change, and an action owns a change it captures along with a restoration. Restorations capturing the same transition preserve earlier ownership when their `beforeCaptureId` matches, and a missing `beforeCaptureId` leaves a differing `before` unknown. When no retained record held the value, the answer is one of the restoration's `vacp.apply_state` records, or `unknown` when the journal dropped records of the session.
- A `concurrent` observation is deferred to later listed execution records when every listed execution has a retained record and a later one captures the ref’s value in its `before` or result. Intermediate values those records never capture enter history as `unknown`, including a value equal to the current one. While a listed execution has no retained record, the change the observation shows is `unknown`. When every listed record precedes the observation, it counts as `external`.
- An action that reached its effects without a captured result makes the next change an observation shows `unknown`, and every ref `unknown` while no capture follows it. An action without a captured result whose `before` shows another value than the current one does the same for that ref, and keeps the current value `unknown` until a capture shows a change. Turns are skipped. A `session` record starts the comparison over.

Returns `unchanged` when no record of the session set the ref's current value, counting the first captured state of a session as its baseline. Returns `unknown` when no record owns the current value, or when the change that set it may lie before the oldest retained record (`revision > records.length`). Records arrive as operations finish, so the record of a running action can still change the answer.

## createProvenanceReplay

```ts
createProvenanceReplay(runtime: ProvenanceReplaySource, options: { restore: VacpRestore }): ProvenanceReplayController
```

Creates one viewer's replay over `runtime`'s journal. `restore` applies a checkpoint's state, such as `createVacpRestorer(runtime).restore`. Throws when the runtime is disposed.

| Member                 | Behavior                                                                      |
| ---------------------- | ----------------------------------------------------------------------------- |
| `getState()`           | The current `ProvenanceReplayState`, the same object until it changes         |
| `subscribe(listener)`  | Notifies when the state changes. Returns a function that removes the listener |
| `review(checkpointId)` | Restores the checkpoint. The first review saves the live state to return to   |
| `close()`              | Restores the saved live state and returns to `live`                           |
| `interrupt()`          | Ends review and cancels pending restoration without restoring the saved state |
| `dispose()`            | Cancels pending work and releases subscriptions without restoring anything    |

```ts
type ProvenanceReplayState = {
  steps: readonly ProvenanceCheckpoint[];
  turns: readonly VacpTurnRecord[];
  selected: ProvenanceCheckpoint | null;
  latest: ProvenanceCheckpoint | null;
  working: boolean;
} & ({ phase: 'live' | 'restoring' | 'reviewing' } | { phase: 'error'; error: string });
```

Outside `live`, `steps` and `turns` stay as they were when review began. `working` is true from the moment an execution that changes the analysis is prepared until its record reaches `steps`. Queries and this viewer's own restorations leave it false. A review request made while `working` is true, or while another review runs, is declined, and the viewer asks again once the work settles. A new change by another actor, a changed external observation, or a new session ends the review and keeps the new state.
