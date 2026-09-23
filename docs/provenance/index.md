# Provenance

The runtime records actions and observations for every actor. Use `@vacp/provenance-core` to inspect that chronology, derive analytical checkpoints, or restore a checkpoint through an explicit host capability.

## Read the journal

Given an application runtime, read its recording independently of the live charts:

```ts
import { provenanceActor, provenanceMessage } from '@vacp/provenance-core';

const snapshot = runtime.getProvenance();
for (const record of snapshot.records) {
  console.log(record.id, provenanceActor(record), provenanceMessage(record));
}

const unsubscribe = runtime.subscribeProvenance((event) => {
  if (event.record) console.log(event.record.kind, event.record.id);
  else console.log('Recording reset', event.epoch);
});

// On unmount:
unsubscribe();
```

`getProvenance()` returns a frozen snapshot with `runtimeId`, optional `sessionKey`, `epoch`, `revision`, the retention `limit`, and immutable `records`. Revisions order recording changes within an epoch. A session reset starts a new epoch, clears retained records, and publishes an event with `record: null`. Consumers must discard selections from the previous epoch.

The runtime retains 256 records by default. Set `historyLimit` when creating the runtime to choose a positive integer bound. Viewers read this retained journal. A viewer can hold an observation while reviewing it even after the runtime evicts its original record.

### Record kinds

| Kind          | Captured facts                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `action`      | Original `call`, `result`, terminal `execution`, optional public `message`, and available `before` and resulting `observation` |
| `observation` | Coherent `observation`, `actor`, `cause`, optional public `message`, and optional semantic `focus`                             |
| `session`     | Session marker with `actor` and optional public `message`                                                                      |

Each record has an `id` and capture time `at`. Action attribution comes from `execution.actor`. Use `provenanceActor(record)`, `provenanceFocus(record)`, and `provenanceMessage(record)` to consume metadata across record kinds.

An action record's `message` is what its actor told the person about the step, as of completion: the explicit `message` passed to `dispatch()`, or the actor's public progress summary, including text streamed while the action ran. Replaying the step shows that same text. Action capture preserves the terminal outcome even when a later observation fails. Missing `before` or `observation` means that capture was unavailable. If a result payload cannot be structured-cloned, the journal retains its success/failure envelope with a `captureErrors` diagnostic. The result returned to the caller remains intact.

### Attribution and concurrency

The host supplies actor identity through execution options or an explicit `runtime.refresh({ actor, message, focus })` after a native application change. Unattributed observations have a system actor.

An observation’s `cause` distinguishes two cases:

- `external`: the observation was recorded independently of an identified execution.
- `concurrent`: the observation overlapped the listed executions. This records timing evidence, without assigning exclusive causality.

Before/after observations describe the state that was captured. They do not establish transaction isolation across independent sources. In particular, native input during an agent operation cannot be attributed from timing alone.

## Derive analytical checkpoints

```ts
import { provenanceActor, provenanceCheckpoints } from '@vacp/provenance-core';

const checkpoints = provenanceCheckpoints(runtime.getProvenance().records);
const agentSteps = checkpoints.filter(
  (step) => step.position === 'after' && provenanceActor(step.record).kind === 'agent',
);
```

A `ProvenanceCheckpoint` contains an `id`, its original `record`, the captured `observation`, and a `position` of `before` or `after`. Metadata stays on the original record. A `before` checkpoint represents the starting state, not the result of the action to which it belongs.

Projection compares analytical state across the full chronology before a viewer filters actors. This preserves an agent’s return to an earlier state after a human edit. It excludes queries, restoration records, intermediate concurrent observations, and consecutive identical analytical states. Freshness and capture timestamps do not create a new checkpoint. Failed operations can produce checkpoints when their captured effects changed the analysis.

## Restore and review checkpoints

Create a controller for each independently navigable viewer. Supply restoration explicitly:

```ts
import { createVacpRestorer } from '@vacp/runtime';
import { createProvenanceReplay } from '@vacp/provenance-core';

const restorer = createVacpRestorer(runtime);
const replay = createProvenanceReplay(runtime, {
  restore: (observation, options) => restorer.restore(observation.state, options),
});

const first = replay.getState().steps[0];
if (first) {
  await replay.review(first.id); // Restore the actual analytical sources.
  await replay.close(); // Restore the state captured when review began.
}

// On unmount:
replay.dispose();
```

Every restored source must expose an available `vacp.apply_state` operation. The restorer validates source ownership, routes each source its state, and reports per-source results. Effects can partially succeed across engines. Inspect the result when invoking the restorer directly. The replay controller exposes a failed restore through its `error` state.

`getState()` returns `phase`, `steps`, `selected`, `latest`, and optional `error`. Phases are `live`, `restoring`, `reviewing`, and `error`. `subscribe(listener)` notifies a viewer to read the current state. `review(id)` selects any retained checkpoint. The consuming UI chooses filters, ordering, and navigation controls.

The controller captures a return observation before its first restore and holds the review trail during navigation. `close()` restores that return observation. A new foreign mutation, changed external observation, or session reset interrupts review. `interrupt()` abandons the return observation and cancels pending work. Disposal also cancels pending work and releases subscriptions. Neither interruption nor disposal restores an earlier state.

Restore requests carry a human actor and restoration correlation through ordinary runtime execution. They remain in the journal and are excluded from checkpoint projection. A controller declines overlapping review requests and review requests made while foreign mutations are active. The UI can retry after those operations finish.

### Interrupt for native input

During a pending restoration, native user input needs a host signal before its eventual state change is observed. Call `interrupt()` from the application’s input boundary. For a browser surface, trusted input can provide that signal:

```ts
const inputIntent = (event: Event) => {
  if (event.isTrusted && replay.getState().phase === 'restoring') replay.interrupt();
};
const events = ['pointerdown', 'keydown', 'input'] as const;
for (const event of events) analysisRoot.addEventListener(event, inputIntent, true);

// On unmount:
for (const event of events) analysisRoot.removeEventListener(event, inputIntent, true);
```

Bind this to the analytical surface, excluding replay controls. A harmless click during settled review leaves navigation active. Actual state changes still interrupt through provenance. Cancellation must reach the provider before effects to prevent them. Effects already applied remain visible and recorded.

[Agent presence](../presence/#replay-the-analytical-trail) accepts an independently owned replay controller. Other inspection surfaces can use the same controller and checkpoint types with their own presentation policy.
