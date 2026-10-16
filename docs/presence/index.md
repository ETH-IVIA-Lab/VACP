# Agent presence

Presence shows the person what an agent is doing. A cursor travels to the control or mark each step changes, and a bubble beside it shows the step's sentence. After the request, the person can step back through the agent's checkpoints. Presence follows every call the runtime executes, whether it arrives through MCP, the AI SDK tools, or WebMCP.

## Add presence

Create a browser presence for the runtime, then attach each provider with its presentation, which tells presence where the provider's entities are on screen:

```ts
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { createBrowserPresence } from '@vacp/presence-browser';
import { installVacpRuntime } from '@vacp/runtime-browser';

const provider = createVegaLiteProvider({ root, view, spec, vgSpec, options });
const { runtime, dispose } = installVacpRuntime({ providers: [provider], exposeBridge: true, injectDomSnapshot: true });
const presence = createBrowserPresence(runtime);
presence.attach(provider, createVegaLitePresentation({ provider, root }));

// On unmount:
presence.dispose();
dispose();
```

For vgplot, use `createVgplotPresentation({ provider, root })` from `@vacp/adapter-vgplot/presentation`. Replacing or detaching a provider releases its targets.

The overlay renders in its own [shadow root](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM) and leaves pointer events, keyboard focus, and scrolling to the person. It shows agent actors. Human and system changes stay in [provenance](../provenance/) without a cursor. Pass `includeActor(actor)` to choose which actors appear.

## Narration

Every step an agent executes carries its own sentence, passed as `narration`:

```ts
await runtime.execute(
  { callId: 'c1', name: 'cohort.set_sports', params: { sports: ['rowing', 'canoe'] } },
  { actor, narration: 'Keeping rowing and canoe to compare the two paddle sports.' },
);
```

The bubble shows the sentence as the step begins, while the cursor travels to its target. Opening and closing sentences come from the agent's progress tool, as [Actors, turns, and narration](../concepts/#actors-turns-and-narration) describes. A step without its own sentence names its change and the view, such as "Filter range applied to Age distribution".

An application that runs its own agent loop can publish progress directly:

```ts
const work = runtime.beginAgentActivity({ actor, summary: 'Comparing rowers and canoeists' });
try {
  await runtime.execute(call, { actor, narration: 'Keeping rowing and canoe.' });
  work.end({ summary: 'The comparison is ready.' });
} catch (error) {
  work.end({ outcome: 'failed' });
  throw error;
}
```

Sentences are public text for the person: at most 280 characters for a step or a progress sentence, and 500 for a summary a host passes to `beginAgentActivity`. Keep reasoning, tool arguments, and query results out of them.

## Replay the trail

Pass a replay controller when you create presence, and the person can step through an agent's request after it finishes. The trail is the sequence of frames for one turn, shown beside the agent's cursor:

```ts
import { createProvenanceReplay } from '@vacp/provenance-core';
import { createVacpRestorer } from '@vacp/runtime';

const restorer = createVacpRestorer(runtime);
const replay = createProvenanceReplay(runtime, { restore: restorer.restore });
const presence = createBrowserPresence(runtime, { replay });

// On unmount, release both:
presence.dispose();
replay.dispose();
```

| Frame      | Words                       | View                                           |
| ---------- | --------------------------- | ---------------------------------------------- |
| Start      | The turn's opening sentence | The state before the first step                |
| Step       | That step's sentence        | The state after the step, cursor at its target |
| Conclusion | The turn's closing sentence | The live state the turn left behind            |

After a turn ends, its conclusion stays on screen. Hovering or focusing the bubble reveals back and forward arrows, and a rail of marks names every frame.

Selecting a frame restores the charts through each source's `vacp.apply_state` operation. New work by the person or the agent ends the review and keeps the new state. When a restoration applies only part of a checkpoint, the trail notes that the view may differ from the recording.

Presence borrows the replay controller and never disposes it. See [Provenance and replay](../provenance/) for the controller's own contract.

## Pace the steps

By default an agent's steps run as fast as it calls them. Pacing makes each step readable: the cursor arrives, the change happens, and the result holds before the next step:

```ts
import { paceAgentPresence } from '@vacp/presence-core';

const stopPacing = paceAgentPresence(runtime, presence, {
  arrivalTimeoutMs: 900,
  beforeExecuteMs: 320,
  afterExecuteMs: 1200,
});
```

Only executions this viewer shows wait, so a person's own interactions never slow down. Pauses never change a result. Missing geometry skips the approach and keeps the configured pauses. Call `stopPacing()` to remove the pauses and keep the viewer.

## Point at custom targets

A custom operation names what it focuses on, and the presentation maps refs to elements:

```ts
import { createElementPresenceResolver, observePresenceLayout } from '@vacp/presence-core/dom';

actions
  .operation('mutation', 'threshold.set', 'Set the threshold')
  .params(z.object({ value: z.number().min(0).max(100) }))
  .focus(() => ({ ref: thresholdRef, interaction: { kind: 'drag', axis: 'x' } }))
  .handle(({ value }) => setThreshold(value));

presence.attach(provider, {
  resolve: createElementPresenceResolver((focus) => (focus.ref === thresholdRef ? thresholdInput : null)),
  subscribe: (invalidate) => observePresenceLayout(chartRoot, invalidate),
});
```

`interaction.kind` chooses the cursor: a pointing hand for `point` and `activate`, a crosshair for `brush`, an open hand for `drag` and `pan`, a caret for `edit`, arrows for `resize`, and a magnifier for `zoom`. A step without a focus points at the first entity in its `affects` that the presentation can place. Canvas and WebGL applications implement `PresenceResolver` directly and return a point, a region, or a path in viewport coordinates.

## Customize the overlay

```ts
const presence = createBrowserPresence(runtime, {
  maxActors: 3,
  appearance: {
    motion: 'system',
    bubble: { width: 290 },
    cursor: { size: 24 },
    ripple: { color: '#16a34a' },
  },
});
```

`motion: 'system'` follows the reduced-motion preference. The [presence-browser reference](../api/presence-browser) lists every appearance option with its default, the cursor assets, and the streamed Markdown text renderer in `@vacp/presence-browser/streamdown`.

## Build another surface

`@vacp/presence-core` runs without the browser. Give it a renderer, and it calls `render(frame)` with the activities to show and the replay navigation:

```ts
import { createAgentPresence } from '@vacp/presence-core';

const presence = createAgentPresence(runtime, {
  renderer: { render: (frame) => renderActivityFeed(frame.activities, frame.navigation) },
});
```

See the [presence-core reference](../api/presence-core) for `PresenceFrame`, `PresenceActivity`, and the execution stream.
