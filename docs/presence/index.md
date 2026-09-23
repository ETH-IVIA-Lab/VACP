# Agent presence

Show an agent's public progress with a hovering cursor, contextual bubbles, and semantic action feedback. Actions run immediately by default. Presence follows the runtime, including actions invoked through MCP and WebMCP.

## Add presence to a visualization

After creating a Vega-Lite view, attach its provider and presentation binding:

```ts
import { createVegaLiteProvider } from '@vacp/adapter-vega-lite';
import { createVegaLitePresentation } from '@vacp/adapter-vega-lite/presentation';
import { installVacpRuntime } from '@vacp/runtime-browser';
import { createBrowserPresence } from '@vacp/presence-browser';

// view, spec, and root come from your Vega embedding.
const config = {
  view,
  spec,
  root,
  options: { appId: 'analysis', viewId: 'overview', vizId: 'scatter' },
};
const provider = createVegaLiteProvider(config);
const installation = installVacpRuntime({ providers: [provider] });
const presence = createBrowserPresence(installation.runtime);
presence.attach(provider, createVegaLitePresentation({ provider, root }));

// On unmount:
presence.dispose();
installation.dispose();
```

For VGPlot, use `createVgplotPresentation({ provider, root })` from `@vacp/adapter-vgplot/presentation`. Each presentation binding shares its provider’s native binding inventory. Replacing or detaching a provider releases its targets and pending lookups.

Presence displays agent actors by default. `includeActor(actor)` sets one visibility policy for live progress, executions, and recorded steps. Human and system changes remain in [provenance](../provenance/) regardless of this policy.

The default arrow retains the inline SVG geometry from agent-browser. Known interactions select dedicated hand, crosshair, text, resize, or zoom assets. Longer moves enlarge the cursor smoothly and settle it back to its resting size. Activation compresses the pointer and emits a blue ripple at the target. Pointing and text editing do not imitate a click. The overlay leaves application pointer events, keyboard focus, and scrolling under human control. Without visible target geometry, the cursor stays at its last position or a configurable starting position. A dashed target cue indicates surface-level precision.

## Report thinking and public progress

Start a host activity before calling a model. Use the same actor ID for progress and action execution:

```ts
const actor = { id: 'analyst', kind: 'agent' as const, label: 'Analyst' };
const work = runtime.beginAgentActivity({
  actor,
  summary: 'Comparing rowers and canoeists',
  signal,
});
try {
  // Await model work or gather context here.
  work.update('Narrowing the comparison to athletes aged 22 to 28');
  await runtime.execute(call, { actor, signal });
  work.end({ summary: 'The comparison is ready' });
} catch (error) {
  work.end({ outcome: signal.aborted ? 'cancelled' : 'failed' });
  throw error;
}
```

Summaries are short, public progress messages, up to 500 characters. Supply deliberate user-facing descriptions from the agent host. Private reasoning, raw tool arguments, and query results are not narration inputs. Bubbles render plain text by default. Applications can opt into [streamed Markdown](#stream-public-progress-with-streamdown). Each update is authoritative, including shorter messages and corrections to capitalization or spacing. An unchanged message does not repeat its text animation or accessibility announcement.

Words about the next step start with that step. When an actor that has already acted sends a new summary while its last action is finished, the viewer keeps the previous words and shows the busy mark until the actor's next action begins, then streams the new words as the cursor travels toward the target. `narrationHoldMs` bounds that wait, 2000 ms by default, and `0` shows every summary as it arrives. Summaries sent while an action runs, and closing summaries passed to `end()`, show at once. `end()` without a summary keeps the last one.

An activity remains visible between actions until `end()`, cancellation, runtime disposal, or a session change. A new activity for the same actor supersedes its previous handle. Late updates from the old handle have no effect. The runtime retains at most 32 active actors. Viewers independently limit displayed actors with `maxActors`.

`getAgentActivities()` and `subscribeAgentActivities()` expose progress without execution authority. Activity reports are ephemeral. At action dispatch, the runtime copies the current public summary into that action’s provenance record. Standalone progress updates do not create analytical steps. `PresenceActivity` contains `actor`, `phase`, optional `summary`, optional `activityId` for the host progress session, optional `subject` naming the view the step works on, optional `execution`, `target`, and `freshness`. A deliberately displayed checkpoint also has `recordId` and can use phase `reviewing`. Every field is derived from one entry per actor, so a new turn clears the previous step's `execution` and `freshness` while the cursor keeps resting on that step's target. A thinking activity can exist before any execution or target exists.

### Let the agent speak for itself

Every transport offers a progress tool: `vacp_progress` for AI SDK agents and the Python MCP server, and `vacp.progress` for WebMCP. Its description asks for one short present-tense sentence addressed to the person about the data and the view, with the reason when it helps them follow, such as "Narrowing to sprinters under 25 to compare medalists at their peak age", without tool names, references, or remarks about the agent itself. The agent calls it before each action and whenever the picture changes, and closes the task with `done: true` and a brief closing sentence that states what the view now shows. That sentence streams into the bubble, travels with the cursor to the action's target, and is copied into the action's provenance record, so replaying the step shows the same reasoning later. Without narration, the bubble names the change and the view, such as "Filter range applied to Age distribution".

`createVacpChatRuntime({ ...options, activity: runtime })` opens one activity per chat turn for actor `agent` and ends it with the stream's outcome. A turn starts without text, so the bubble shows its waiting indicator until the model narrates. Lifecycle wording such as "Checking the view" only fills a turn in which the model has not spoken yet; the model's own sentences are never overwritten. Reasoning and response tokens stay in the chat stream. For domain-specific summaries, the host can still use `beginAgentActivity()` directly.

`installVacpWebMcp(runtime)` registers `vacp.progress` for the same actor as its action tools, so narration and executions share one presence entry. A WebMCP turn closes with `done: true` or after 15 quiet seconds.

## Stream public progress with Streamdown

The optional browser entry point uses Streamdown 2.6, React, and React DOM. The default presence entry point and the headless runtime do not import them.

```ts
import { createBrowserPresence } from '@vacp/presence-browser';
import { createStreamdownText } from '@vacp/presence-browser/streamdown';

const presence = createBrowserPresence(runtime, {
  appearance: {
    text: createStreamdownText,
    bubble: { width: 290 },
  },
});

const work = runtime.beginAgentActivity({ actor, summary: '' });
let summary = '';
for await (const chunk of publicProgressStream) {
  summary += chunk;
  work.update(summary);
}
work.end({ summary });
```

Pass the accumulated public summary to `update()`, within the 500-character limit. Agents usually send whole sentences, so the renderer reveals text a word at a time, about 14 words a second and never slower than 2.6 seconds for the whole message. Each new word rises in over 240 ms, a small caret marks the end while text is still arriving, and incomplete Markdown is repaired as it lands. Line changes animate the bubble height. Screen-reader announcements receive the complete message. The renderer coalesces updates within a frame and preserves existing paragraphs. Replacing a message starts a new rendering sequence. Appending text preserves the current sequence, and an exact duplicate leaves its content unchanged, including when a finished turn hands its last words to the recorded step that stays on screen.

Completed and replayed messages render in static mode without animation or caret. Reduced motion keeps incremental updates and formatting while disabling word and height animation. Screen-reader announcements coalesce after a brief pause and use rendered text instead of Markdown syntax.

The compact bubble supports emphasis, inline code, paragraphs, and lists. Raw HTML stays literal, and embedded images and interactive Markdown controls are excluded. Styling is scoped to the presence shadow root. Applications do not need Tailwind or global Streamdown CSS. `PresenceTextFactory` provides the browser-only content port for another renderer.

All five examples compose Streamdown, pacing, and the replay stepper through their shared example integration.

## Replay the analytical trail

Compose a [provenance replay controller](../provenance/#restore-and-review-checkpoints) with an explicit restoration capability:

```ts
import { createVacpRestorer } from '@vacp/runtime';
import { createProvenanceReplay } from '@vacp/provenance-core';
import { createBrowserPresence } from '@vacp/presence-browser';

const restorer = createVacpRestorer(runtime);
const replay = createProvenanceReplay(runtime, {
  restore: (observation, options) => restorer.restore(observation.state, options),
});
const presence = createBrowserPresence(runtime, { replay });
// Attach provider presentation bindings as in the visualization setup.

// On unmount, release both independently owned consumers:
presence.dispose();
replay.dispose();
```

Once there are agent steps to revisit, the latest bubble remains available. Hover or keyboard focus reveals previous and next arrows. Touch devices show the controls directly. During replay, a close icon returns to the state captured when replay began. The arrows select completed checkpoints allowed by `includeActor`. The controller retains the full chronology for other consumers.

Selecting a checkpoint restores the actual charts through each source’s `vacp.apply_state` operation. The recorded actor and public summary describe the original action. Restoration has its own human attribution and correlation metadata in provenance.

New live mutations or observed external state changes stop replay and preserve the new work. After a turn ends, the agent's last recorded step stays on screen, also when the turn took a single step, until the person dismisses it, changes the analysis, or the agent starts new work. A one-step trail offers only the dismiss control. Human changes dismiss retained agent feedback while ongoing agent thinking remains visible; the runtime's own system observations leave the agent's last step on screen, and never bring a dismissed trail back. A checkpoint selected through the shared replay controller that this viewer does not show, such as a human step, renders nothing and offers no step from it. During a pending restoration, the host should call `replay.interrupt()` when native input begins in the analytical surface. See the [host input integration](../provenance/#interrupt-for-native-input). Interruption cancels pending work and abandons the saved return state. It cannot roll back effects a provider has already applied.

A failed restoration remains visible and may have partial effects across providers. Navigation prevents overlapping restore requests. Each controller owns its selected checkpoint and saved return state. Session changes and disposal cancel pending work. Disposing presence releases the viewer but leaves its supplied replay controller under host ownership.

## Customize appearance and timing

```ts
const presence = createBrowserPresence(runtime, {
  maxActors: 3,
  lingerMs: 1800,
  narrationHoldMs: 2000,
  appearance: {
    motion: 'system',
    durationMs: 320,
    travel: { scale: 1.6, minDistance: 80, fullDistance: 500 },
    cursor: { size: 28, fill: 'white', stroke: 'black', strokeWidth: 1.5 },
    press: { scale: 0.8, durationMs: 260 },
    ripple: { color: '#60a5fa', size: 64, durationMs: 400 },
    cue: { color: '#62666c', visible: true },
    bubble: { width: 260 },
    hover: { distance: 2.5, periodMs: 2600 },
    bloom: { color: '#78b7ff', radius: 22 },
  },
});
```

`motion: 'system'` respects reduced-motion preferences. Use `reduced` for static positioning or `full` to explicitly enable movement. `travel: false` disables enlargement while retaining position interpolation. Distances are CSS pixels, and `scale` is the maximum multiplier. Retargeting preserves position, velocity, and scale. Critically damped motion settles at each target. The bubble rides below the cursor while it travels, keeps clear of the region it is heading for, and settles beside the target on arrival. `bubble: false`, `hover: false`, and `bloom: false` independently disable those effects. An agent bubble's heading holds a small mark and the name of the view being worked on, such as "Age distribution", read from the live graph through the step's focus. While the agent is thinking or acting, four gathering blocks (adapted from loading.dev) crossfade in place of the Lucide bot mark and return once the step completes. During replay the heading reads "Step 2 of 5". `bubble: { icon }` replaces the mark with stroked path data in a 24-unit square, and `icon: false` removes it. While an agent is thinking without a public summary, the bubble shows a short waiting line such as "Looking at Age distribution" instead of empty narration. `idlePosition(viewport)` sets the initial browser cursor location. Motion and hover pause while the document is hidden. Reduced motion retains a static cursor and bubble. `appearance.describe(activity)` controls status wording, and `appearance.document` selects the owning document for an iframe or another window.

Live, retained, and replayed targets are re-resolved when the page or a nested container scrolls. Viewport tracking updates coordinates directly. Travel between agent actions retains its animation, and a scroll during travel shifts the flight with the surface instead of restarting it. Targets are clipped to the viewport and their scroll containers. Fully hidden targets hide their cursor and outline while the bubble remains available for progress and replay controls.

Bubbles sit beside the agent cursor, outside the region it acts on, and move with it from step to step, including through replay. Placement preserves the previous side when space permits, stays within the viewport, and minimizes overlap when no side fits. Clear paths animate smoothly. A move that would cross the target fades at its destination. Nonspatial reads retain the last target exclusion.

An action may finish before the cursor arrives. Status reflects the execution outcome immediately. Output freshness is separate: `current`, `updating`, `error`, or `unknown`. Providers must report freshness before a viewer can claim outputs are current.

### Pace a sequence

The host grants pacing authority separately from creating a viewer:

```ts
import { paceAgentPresence } from '@vacp/presence-core';

const presence = createBrowserPresence(runtime, { appearance: { durationMs: 420 } });
const stopPacing = paceAgentPresence(runtime, presence, {
  arrivalTimeoutMs: 700,
  beforeExecuteMs: 180,
  afterExecuteMs: 650,
});

// Release timing authority while keeping the viewer attached.
stopPacing();
```

`arrivalTimeoutMs` bounds target resolution and cursor travel. `beforeExecuteMs` pauses before the handler starts. `afterExecuteMs` holds the completed result before returning it, so a caller awaiting consecutive actions has time to observe each change; it is the gap between one agent step and the next. Execution status and freshness remain live during these pauses. Concurrent calls remain concurrent. Only executions shown by the paced viewer wait, so a person's own interactions are never delayed.

The examples pace agent work with `arrivalTimeoutMs: 900`, `beforeExecuteMs: 320`, and `afterExecuteMs` set from the example option `agentStepPauseMs` (1200 ms by default), with a 460 ms cursor travel. Each agent step then reads as travel, a beat at the target, the change, and a pause before the next step can begin. Set `globalThis.__vacpExampleOptions = { agentStepPauseMs: 1500 }` before the example loads to lengthen the pause, or `paceAgentSteps: false` to remove pacing.

Creating a viewer alone never changes execution timing. Calling `paceAgentPresence` with `{}` waits up to 350 ms for arrival, with no intentional pauses. Each timing option accepts 0 to 60,000 ms. Missing geometry skips the approach, while configured pauses still apply. Disposal releases presentation waits. Cancellation before execution prevents the action. Cancellation during the final pause releases the already-completed runtime result and preserves its history.

Set `press: false` or `ripple: false` under `appearance` to disable either effect. Reduced motion replaces scaling and ripple expansion with a short static target ring. The ripple acknowledges semantic activity, and does not signal output freshness.

## Bind custom actions

Describe the intentional focus after parameter parsing:

```ts
import { z } from 'zod';

actions
  .operation('mutation', 'threshold.set', 'Set threshold')
  .title('Set threshold')
  .params(z.object({ value: z.number().min(0).max(100) }))
  .focus(({ value }) => ({
    ref: thresholdRef,
    detail: { value },
    interaction: { kind: 'drag', axis: 'x' },
  }))
  .affects(chartRef)
  .handle(({ value }) => setThreshold(value));
```

The focus callback receives the same normalized parameters as the handler. Keep focus details serializable and limited to the domain values needed for targeting. `affects` identifies analytical effects. `focus` identifies the intended interaction.

Bind refs to visible elements explicitly:

```ts
import { createElementPresenceResolver, observePresenceLayout } from '@vacp/presence-browser';

presence.attach(provider, {
  resolve: createElementPresenceResolver((focus) => (focus.ref === thresholdRef ? thresholdInput : null)),
  subscribe: (invalidate) => observePresenceLayout(chartRoot, invalidate),
});
```

Canvas and WebGL applications can implement `PresenceResolver` directly. Return a point, region, or path in the renderer's named coordinate surface, or `null` when no location is known. The browser renderer uses CSS viewport pixels on the `viewport` surface. `svgPresenceTarget(element, geometry)` applies a live SVG screen transform. Resolvers receive an abort signal and should release pending work when it aborts.

## Interaction meaning and assets

`VacpFocus.interaction` is optional, serializable context. It travels with the validated focus through execution and headless presence snapshots. The protocol carries meaning. Each renderer decides how to express it.

| Kind                    | Default cursor                                              |
| ----------------------- | ----------------------------------------------------------- |
| Omitted or unrecognized | Original arrow                                              |
| `point`, `activate`     | Pointing hand                                               |
| `brush`                 | Crosshair                                                   |
| `drag`, `pan`           | Open hand, closed while running or acknowledging activation |
| `edit`                  | Text caret                                                  |
| `resize`                | Horizontal, vertical, or four-way arrow according to `axis` |
| `zoom`                  | Magnifier, optionally with `direction: 'in'` or `'out'`     |

Vega-Lite supplies these hints for interval and point selections, tooltip focus, and bound controls. VGPlot supplies them for intervals, regions, toggles, legends, tables, native sliders/search, and viewport changes. Domain comparisons distinguish known pan and zoom changes. Geometry and interaction meaning remain independent, so the same semantics work with SVG, Canvas, or a custom surface.

Custom kinds are ordinary strings. Put domain-specific details in the existing typed `focus.detail`. A custom renderer reads `activity.execution?.intent?.focus?.interaction`. This is a description of the semantic operation, not a synthetic mouse-event sequence.

To extend the browser defaults:

```ts
import { createBrowserPresence, defaultCursorPresentation, type CursorAsset } from '@vacp/presence-browser';

const lasso: CursorAsset = {
  path: 'M12 3a8 7 0 1 0 0 14c3 0 4 2 2 4',
  hotspot: { x: 12, y: 10 },
  fill: 'none',
};
const presence = createBrowserPresence(runtime, {
  appearance: {
    cursor: {
      assets: { lasso },
      resolve: (activity) =>
        activity.execution?.intent?.focus?.interaction?.kind === 'lasso'
          ? { shape: 'lasso', feedback: false }
          : defaultCursorPresentation(activity),
    },
  },
});
```

`cursor.resolve(activity)` returns a shape, an optional `activeShape` while running or acknowledging activation, and optional `feedback` to control press/ripple acknowledgement. Override only the interactions you need and delegate others to `defaultCursorPresentation`. To use one shape everywhere, return the same shape from this callback. Unknown shape names use your configured arrow asset.

Assets are inline SVG paths in a 24-unit square. Their hotspots stay fixed on the resolved target during size changes and pressing. `defaultCursorAssets` exposes the built-in geometry for custom surfaces. Hand silhouettes adapt the MIT-licensed Tabler Icons. The original arrow retains its agent-browser attribution. Reduced motion disables travel and press scaling while retaining semantic shapes and static activation feedback.

## Build another inspection surface

`@vacp/presence-core` runs independently of browser APIs:

```ts
import { createAgentPresence } from '@vacp/presence-core';

const presence = createAgentPresence(runtime, {
  renderer: {
    render: (frame) => renderActivityFeed(frame.activities, frame.navigation),
    dispose: () => clearActivityFeed(),
  },
});

presence.attach({
  ...runtime.getProviderBinding(provider),
  sourceId: provider.source.id,
  resolve: resolveLocalTarget,
});
```

`PresenceFrame` contains the displayed `activities`, optional `navigation`, and a `reason` of `activity` or `layout`. The same renderer receives live, retained, and replayed presentation. `navigation` exposes back, forward, and close callbacks plus their availability and restoration state.

For a live activity feed, omit `renderer` and use `getSnapshot()` with `subscribe(listener)`. These methods expose live activities, independently of retained or replayed presentation. Each viewer owns its activity and cleanup. Visual bursts coalesce per actor while the runtime retains every execution event.

The browser adapters resolve ranges through live scales and renderer transforms. A point selection that cannot be mapped to one rendered mark falls back to a surface cue. Faceted VGPlot interactions use a visible brush group. Custom selection idioms can supply their own resolver.

## Attribute agent activity

Pass actor identity through trusted host context:

```ts
await runtime.execute(call, {
  actor: { id: 'analyst-1', label: 'Analyst', kind: 'agent' },
  signal,
});
```

`installVacpWebMcp(runtime, { actor })` forwards the configured actor through the same execution path. Its default actor ID is `webmcp`. Other runtime calls default to `agent`. Actor identity is separate from action parameters.

Use `runtime.subscribeExecutions(listener)` for the complete lifecycle. Events contain a runtime execution ID, monotonic sequence, caller call ID, actor, source binding, semantic intent, and phase. Phases are `accepted`, `prepared`, `running`, and one terminal outcome: `succeeded`, `failed`, or `cancelled`. Parameters and results stay out of this stream. Capability and state reads do not create action activity.
