# Provenance and replay

The runtime records every action and every change it observes, by any actor. A replay controller turns those records into checkpoints and restores the views to the one the person picks. Both ship in `@ethivia/vacp-sdk`.

```ts
import { createProvenanceReplay, createVacpRestorer } from '@ethivia/vacp-sdk';

const replay = createProvenanceReplay(runtime, { restore: createVacpRestorer(runtime) });

const [first] = replay.getState().checkpoints;
if (first) {
  await replay.review(first.id); // restores the views to this checkpoint
  await replay.close(); // restores the state from before the review
}

// When the view unmounts:
replay.dispose();
```

`runtime` comes from `const { runtime } = installVacpRuntime(...)`. The controller lives in your app and is separate from `window.__vacp`. A `runtime.record()` at startup becomes the first checkpoint, so `checkpoints[0]` is the view before any change. `createVacpRestorer` applies a recorded state through each source's `vacp.apply_state` action. The Vega-Lite and vgplot providers register that action, and [Restore recorded state](../custom-provider/#restore-recorded-state) adds it to your own provider. If a recorded ref has no such action, the restorer applies nothing.

[Presence](../presence/#let-the-person-replay-the-steps) draws this controller as a trail beside the agent's cursor. The rest of this page builds your own controls on it.

## Show the checkpoints

```ts
replay.subscribe(() => {
  const { checkpoints, selected, phase } = replay.getState();
  render(
    checkpoints.filter((checkpoint) => checkpoint.record.actor.kind === 'agent'),
    selected,
    phase,
  );
});
```

`render` stands for your own drawing code. Each checkpoint has an `id`, the `record` that produced it, the captured `observation`, and a `position` of `before` or `after` the action. `phase` is `live`, `restoring`, `reviewing`, or `error`. A review request made while an action that changes the analysis runs is declined, so offer the controls again when `working` turns false. New work by the person or the agent ends the review and keeps the new state. The [provenance reference](../api/provenance#createprovenancereplay) lists every state field.

## Stop a restore when the person edits

A person may start editing while a restore still runs. Call `interrupt()` from your input handlers so the restore stops before it overwrites the edit:

```ts
const onInput = (event: Event) => {
  if (event.isTrusted && replay.getState().phase === 'restoring') replay.interrupt();
};
for (const type of ['pointerdown', 'keydown', 'input']) analysisRoot.addEventListener(type, onInput, true);
```

`analysisRoot` is the element that holds your views. Keep your replay controls outside it, so a click on them leaves the restore running. Changes a provider already applied stay applied.

## Show who set a value

`provenanceAttribution` returns the record that set a ref's current value:

```ts
import { provenanceAttribution, type VacpRef } from '@ethivia/vacp-sdk';

function setBy(ref: VacpRef): string {
  const origin = provenanceAttribution(runtime.getProvenance(), ref);
  if (origin === 'unchanged') return 'Unchanged in this session';
  if (origin === 'unknown') return 'Origin unknown';
  return `Set by ${origin.actor.kind}`;
}
```

Call it again whenever `runtime.subscribeProvenance` reports a record. A person's change reaches provenance with the right actor only when your input handler calls `runtime.record` with that actor, as in [Report human changes](../custom-provider/#report-human-changes). Call `runtime.record()` once at startup, so the first state counts as the session's baseline. The [reference](../api/provenance#provenanceattribution) gives the rule for each record kind.

## Read the records

```ts
import { provenanceCheckpoints } from '@ethivia/vacp-sdk';

const { records } = runtime.getProvenance();
const checkpoints = provenanceCheckpoints(records);
const unsubscribe = runtime.subscribeProvenance(({ record }) => {
  if (record) console.log(record.kind, record.actor.kind);
});
```

A record is an `action`, an `observation`, a `turn` that closes an agent's request, or a `session` boundary. An event with `record: null` starts a new session, and a viewer drops what it showed from the previous one. `provenanceCheckpoints` derives checkpoints from a list of records, the same way the replay controller does. `installVacpRuntime` keeps the latest 256 records. `createVacpRuntime({ historyLimit })` sets another limit. [`ProvenanceRecord`](../api/protocol#provenancerecord) describes each kind.

## Next

- [Show the agent's steps with presence](../presence/)
- [Provenance reference](../api/provenance)
