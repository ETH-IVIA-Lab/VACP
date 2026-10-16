# @vacp/provenance-core

Checkpoints and replay over the runtime's provenance journal. The [Provenance and replay guide](../provenance/) explains attribution, projection, and review.

## provenanceCheckpoints

```ts
provenanceCheckpoints(records: readonly VacpProvenanceRecord[]): ProvenanceCheckpoint[]
type ProvenanceCheckpoint = { id: string; record: VacpProvenanceRecord; observation: VacpObservation; position: 'before' | 'after' };
```

Projects records into analytical checkpoints, oldest first. It compares state across the whole chronology, and skips queries, restorations, intermediate concurrent observations, and consecutive identical states. A `before` checkpoint is the state an action started from. Its metadata stays on `record`.

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
