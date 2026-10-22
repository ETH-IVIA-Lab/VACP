# Provenance and replay

The runtime records every completed operation and every change it observes, for every actor, in a journal of immutable records. `@ethivia/vacp-provenance` derives checkpoints from that journal, names the record that set each value, and restores the charts to a chosen checkpoint. A viewer is one surface that shows the journal, such as presence or an inspection panel. Each viewer keeps its own selection and review state.

## Read the journal

```ts
import { provenanceActor } from '@ethivia/vacp-protocol';

const { records } = runtime.getProvenance();
for (const record of records) console.log(record.kind, provenanceActor(record).kind, record.message);

const unsubscribe = runtime.subscribeProvenance((event) => {
  if (event.record) console.log('recorded', event.record.id);
  else console.log('new session', event.epoch);
});
```

`getProvenance()` returns a frozen snapshot: `runtimeId`, `sessionKey`, `epoch`, `revision`, the retention `limit`, and `records`. `subscribeProvenance` publishes each new record. An epoch is one session of the journal. A changed `sessionKey` or a cleared journal starts a new one, published as an event with `record: null`, and a viewer then drops any selection from the previous epoch.

The runtime keeps the latest 256 records. Pass `historyLimit` to `createVacpRuntime` to change it. `revision` counts every record captured in the epoch, so a snapshot with `revision > records.length` has dropped its oldest `revision - records.length` records. A host that keeps a durable record of a session checks this before treating `records` as complete, and sets `historyLimit` to cover the session.

| Record        | Captures                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `action`      | `call`, `result`, the terminal `execution` with actor and narration, and the `before` and after `observation` |
| `observation` | A change observed without an operation, with its `actor`, `cause`, and `observation`                          |
| `turn`        | The end of an agent turn: `activityId`, `outcome`, `opening` sentence, and closing `message`                  |
| `session`     | A session boundary                                                                                            |

`provenanceActor(record)`, `provenanceFocus(record)`, and `provenanceTurn(record)` from `@ethivia/vacp-protocol` read the actor, the focus, and the turn's `activityId` across record kinds.

An action record keeps its outcome even when a later read fails. A missing `before` or `observation` means the runtime could not capture it. A result payload that cannot be cloned keeps its success or failure envelope and lists the omitted field in `captureErrors`. The caller still receives the original result.

## Attribution

The host supplies the actor: with each `execute` call, or with `runtime.refresh({ actor, message })` after a change in the application. A change the runtime observes through a provider's invalidation, with no actor, is a `system` observation. An observation's `cause` is `external` when no operation was running, or `concurrent` with the executions that overlapped it. Overlap records timing and claims no causality. A person dragging a brush while an agent's step runs cannot be told apart by timing alone.

## Who set a value

`provenanceAttribution` returns the record that set one ref's current value, so an interface can show where a value came from:

```ts
import { provenanceActor, type VacpRef } from '@ethivia/vacp-protocol';
import { provenanceAttribution } from '@ethivia/vacp-provenance';

function setBy(ref: VacpRef): string {
  const origin = provenanceAttribution(runtime.getProvenance(), ref);
  if (origin === 'unchanged') return 'Unchanged in this session';
  if (origin === 'unknown') return 'Origin unknown';
  if (origin.kind === 'action' && origin.execution.restoration) return 'Restored';
  return `Set by ${provenanceActor(origin).kind}`;
}
```

An action record holds the actor, the call, the narration, and the time, and an observation holds the actor, the message, and the time. Call `provenanceAttribution` again when `subscribeProvenance` publishes a record. Records arrive as operations finish, so the record of a running action can still change the answer.

An action owns the changes its captured `before` and result show, even when it failed, and a query owns none. A person's change belongs to the observation `refresh` records when the input handler calls `refresh` before it awaits anything, as in [Report human changes](../integrate/#report-human-changes). Otherwise a provider's invalidation can record the change first, as a `system` observation. A change a provider's invalidation reports while an action runs belongs to that action when its captured result shows the change. When a `refresh` lands while an action or a restoration runs, or two actions run at the same time, either record could have set a value both show, so the value stays `unknown` until a record captures a new change. The journal orders records by when they finish, so an action that sets a value again after a change nobody reported reads the same as two actions running at the same time. Report the change with `refresh` and the action owns the value it sets.

A restoration gives each value it restores back to the owner the ref had when it last held that value, so closing a [review](#restore-and-review) returns every value to its owner from before the review. A value captured in a differing `before` has unknown ownership, even when an earlier record held the same value. Restorations capturing the same transition preserve earlier ownership when their `beforeCaptureId` matches. A value no record of the session held names one of the restoration's `vacp.apply_state` records.

`unchanged` means no record of the session set the ref's current value. The first captured state of a session is its baseline, so call `runtime.refresh()` once when the application starts. `unknown` also covers a change in records the journal no longer retains. The [reference](../api/provenance#provenanceattribution) lists the rule for every record kind.

## Checkpoints

```ts
import { provenanceActor } from '@ethivia/vacp-protocol';
import { provenanceCheckpoints } from '@ethivia/vacp-provenance';

const checkpoints = provenanceCheckpoints(runtime.getProvenance().records);
const agentSteps = checkpoints.filter(
  (step) => step.position === 'after' && provenanceActor(step.record).kind === 'agent',
);
```

A checkpoint has an `id`, its original `record`, the captured `observation`, and a `position`: `before` for the state an action started from, `after` for its result. `provenanceCheckpoints` compares analytical state across the whole chronology before any filter by actor, so an agent's return to an earlier state after a person's edit is still a checkpoint. It skips queries, restorations, intermediate concurrent observations, and consecutive identical states. A failed operation that changed the analysis before failing still produces a checkpoint.

## Restore and review

A replay controller lets one viewer step through checkpoints. The host supplies restoration:

```ts
import { createProvenanceReplay } from '@ethivia/vacp-provenance';
import { createVacpRestorer } from '@ethivia/vacp-runtime';

const restorer = createVacpRestorer(runtime);
const replay = createProvenanceReplay(runtime, { restore: restorer.restore });

const [first] = replay.getState().steps;
if (first) {
  await replay.review(first.id); // restores the charts to this checkpoint
  await replay.close(); // restores the state from before the review
}

replay.dispose();
```

The restorer first checks that every recorded ref has an owner with a `vacp.apply_state` operation, and applies nothing when one is missing. It then applies each source's recorded state through that operation and reports one result per source. Sources restore independently, so one can succeed while another fails. Restoration runs as an operation by `vacpHumanActor` that carries a restoration ID, and checkpoint projection leaves it out of the trail.

`replay.getState()` returns the `steps`, the finished agent `turns`, the `selected` checkpoint, the `latest` checkpoint, `working`, and a `phase` of `live`, `restoring`, `reviewing`, or `error`. An `error` phase carries the failure message. `working` is true from the moment an execution that changes the analysis is prepared until its record reaches `steps`. Queries and this viewer's own restorations leave it false. A review request made while `working` is true, or while a restoration runs, is declined, so the viewer asks again once the work settles.

A new change by another actor, a changed external observation, or a session reset ends the review and keeps the new state. `close()` returns to the state captured when review began. `interrupt()` and `dispose()` end the review without restoring anything.

### Interrupt for native input

A person may start editing while a restoration is still running. Call `interrupt()` from the application's input boundary so the pending restoration cancels before it can overwrite the edit:

```ts
const onInput = (event: Event) => {
  if (event.isTrusted && replay.getState().phase === 'restoring') replay.interrupt();
};
for (const type of ['pointerdown', 'keydown', 'input']) analysisRoot.addEventListener(type, onInput, true);
```

Bind the listener to the analytical surface and leave the replay controls out. Changes a provider already applied stay applied and recorded.

[Agent presence](../presence/#replay-the-trail) renders a replay controller as a trail beside the agent's cursor. Other surfaces can drive the same controller with their own controls.
