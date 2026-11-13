# @ethivia/vacp-sdk/presence

These exports tell a renderer which actors are active, what each step targets, where its target is on screen, and how replay frames are navigated. [`@ethivia/vacp-overlay`](./overlay) renders them in the browser. The [Agent presence guide](../presence/) shows the common setups.

```ts
import {
  createAgentPresence,
  createElementPresenceResolver,
  createRefPresentation,
  elementPresenceTarget,
  observePresenceLayout,
  paceAgentPresence,
  presenceAnchor,
  svgPresenceTarget,
  viewportPresenceTarget,
  type AgentPresence,
  type PresenceActivity,
  type PresenceArrival,
  type PresenceFrame,
  type PresenceFreshness,
  type PresenceGeometry,
  type PresenceNavigation,
  type PresenceOptions,
  type PresencePacing,
  type PresencePoint,
  type PresencePresentation,
  type PresenceRenderer,
  type PresenceResolver,
  type PresenceSource,
  type PresenceTarget,
  type PresenceTrailFrame,
} from '@ethivia/vacp-sdk/presence';
```

## createAgentPresence

```ts
function createAgentPresence(runtime: PresenceSource, options?: PresenceOptions): AgentPresence;
```

Creates one independent viewer of the runtime. Presence never executes anything.

- `options.renderer`: a [`PresenceRenderer`](#presencerenderer). Default: none.
- `options.includeActor`: which actors appear, live and in replay. Default: agents only.
- `options.replay`: a [provenance replay controller](./provenance#createprovenancereplay) presence navigates and never disposes. Default: none.
- `options.maxActors`: the actors shown at once, a positive integer. Default: `4`.
- `options.lingerMs`: how long a finished step stays before its frame retires. Default: `1600`.
- `options.narrationHoldMs`: how long a sentence that arrives between steps waits for the next step to begin. `0` shows it at once. Default: `2000`.
- `options.onError`: receives renderer, resolver, subscription, and `onUnplaced` failures. Default: none.
- `options.onUnplaced`: receives each step presence could not place, described in [Unplaced steps](#unplaced-steps). Default: none.

Returns an [`AgentPresence`](#agentpresence). Throws for an invalid `maxActors`, `lingerMs`, or `narrationHoldMs`, and when the runtime is disposed.

## PresenceSource

```ts
type PresenceSource = VacpExecutionSource & {
  getAgentActivities(): readonly Activity[];
  subscribeAgentActivities(listener: (activity: Activity) => void): () => void;
  getProviderBinding(provider: VacpProvider): { id: string; signal: AbortSignal };
  subscribeSnapshots(listener: (snapshots: { observation: VacpObservation }) => void): () => void;
};
// Activity: { id; actor: VacpActor; phase: 'thinking' | 'completed' | 'failed' | 'cancelled'; summary?; at }
```

The part of a [`VacpRuntime`](./runtime#vacpruntime) presence reads.

## AgentPresence

- `signal`: aborts on `dispose()`.
- `attach(provider, presentation)`: resolves the provider's targets through a [`PresencePresentation`](#presencepresentation) while the provider's binding lives. Returns a detach function. Throws when the provider is not attached to the runtime or a presentation is already attached to its binding.
- `getSnapshot()`: the live activities.
- `subscribe(listener)`: notifies with the live activities when they change, and returns a function that removes the listener.
- `invalidateTargets()`: resolves every shown target again, such as after a resize.
- `arrive(executionId, signal)`: resolves when the renderer reports the cursor at the step's target.
- `dispose()`: releases subscriptions, targets, and the renderer.

## PresenceRenderer

```ts
type PresenceRenderer = {
  render(frame: PresenceFrame): void;
  arrive?: (executionId: string, signal: AbortSignal) => Promise<void>;
  dispose?(): void;
};
```

Draws presence. `render` receives a frame for every change to live, retained, or replayed presentation. `arrive` resolves when the cursor reaches the step's target, and [`paceAgentPresence`](#paceagentpresence) waits on it.

## PresenceFrame

```ts
type PresenceFrame = {
  activities: readonly PresenceActivity[];
  reason: 'activity' | 'layout';
  navigation?: PresenceNavigation;
};
```

`reason: 'layout'` means only target geometry moved.

## PresenceActivity

```ts
type PresenceActivity = {
  actor: VacpActor;
  phase: 'thinking' | 'acting' | 'completed' | 'failed' | 'cancelled' | 'reviewing';
  summary?: string;
  frame?: PresenceTrailFrame;
  recordId?: string;
  activityId?: string;
  subject?: string;
  execution?: VacpExecution;
  target: PresenceTarget | null;
  freshness: PresenceFreshness;
};
type PresenceTrailFrame = 'start' | 'step' | 'conclusion';
type PresenceFreshness = 'unknown' | 'updating' | 'current' | 'error';
```

What one actor shows.

- `summary`: the step's or turn's sentence.
- `frame`: for a recorded frame, the state the request began from, one of its steps, or its conclusion.
- `recordId`: the provenance record a recorded frame shows.
- `activityId`: the actor's turn.
- `subject`: the view the step works on.
- `freshness`: `current` only when the provider reported a current output for the step's target.

## PresenceNavigation

```ts
type PresenceNavigation = {
  frames: readonly PresenceTrailFrame[];
  index: number;
  canBack: boolean;
  canForward: boolean;
  reviewing: boolean;
  restoring: boolean;
  working: boolean;
  diverged: boolean;
  go(index: number): void;
  back(): void;
  forward(): void;
  close(): void;
};
```

Steps through the frames of the request being shown.

- `frames`: the request's frames, in order. A request has at most one start and one conclusion.
- `index`: the shown frame, or `-1` when the shown state lies outside this request.
- `working`: an agent's turn is open, or another actor's change has yet to reach the trail. While `working` is true, `canBack` and `canForward` are false and step calls do nothing, so call again once the work settles.
- `diverged`: the shown frame was only partly restored, so the live view may differ from the recording.
- `go(index)`: shows another frame. The conclusion is the live state after the request.
- `close()`: leaves review or dismisses the retained step. Either hides the trail until the agent starts other work.

## PresenceTarget

```ts
type PresenceTarget = { surface: string; geometry: PresenceGeometry; precision: 'exact' | 'region' | 'surface' };
type PresenceGeometry =
  | { kind: 'point'; point: PresencePoint }
  | { kind: 'region'; x: number; y: number; width: number; height: number }
  | { kind: 'path'; points: readonly PresencePoint[] };
type PresencePoint = { x: number; y: number };
```

A place on a named presentation surface.

## PresenceResolver

```ts
type PresenceResolver = (
  focus: VacpFocus,
  options: { signal: AbortSignal },
) => PresenceTarget | null | Promise<PresenceTarget | null>;
```

Places a [focus](./protocol#vacpfocus). Returns `null` when it cannot place it.

## PresencePresentation

```ts
type PresencePresentation = {
  resolve: PresenceResolver;
  subscribe?: (invalidate: () => void) => () => void;
};
```

What [`attach`](#agentpresence) takes for one provider. [`createVegaLitePresentation`](./vega) and [`createVgplotPresentation`](./vgplot) build one for their charts.

`subscribe` reports that the source's geometry changed. Presence calls it only while a pointer or a recorded frame rests on the provider, and releases it when none does. Setup failures reach `onError` and retry the next time the source is watched.

## Unplaced steps

`onUnplaced` receives a step as a [`PresenceActivity`](#presenceactivity) with `target: null`. Presence reports the step as it leaves, when an attached presentation answered for the step's focus, or for the refs it affects, and placed none of them while the step was shown.

- Every lookup that completes while the step is shown counts. Presence looks again on each snapshot while a live step is shown, once review restores a recorded step's checkpoint, and whenever `subscribe` reports a layout change.
- The step counts as placed when any of its lookups finds its target before it leaves, such as a target the step's own change reveals or the restored view renders a frame later.
- A live step leaves after its execution settled, when the actor's next step or turn begins, `lingerMs` ends, `maxActors` makes room for another actor, or its presentation detaches. A step its actor replaces before the step settles, such as one of several parallel calls, goes unreported.
- A recorded step is shown once review restores its checkpoint, and leaves when review shows another frame or ends, so each review can report it once.
- With the target functions on this page, a target outside the viewport counts as placed, and a target hidden by a scroll container or a clip does not.
- A step whose refs belong to a source without an attached presentation goes unreported, and `dispose()` reports nothing.

## presenceAnchor

```ts
function presenceAnchor(geometry: PresenceGeometry): PresencePoint | null;
```

Returns the point a cursor rests on: a point itself, the center of a region, or the last point of a path. Returns `null` for an empty path.

## elementPresenceTarget

```ts
function elementPresenceTarget(element: Element, precision?: PresenceTarget['precision']): PresenceTarget | null;
```

Returns the element's box on the `viewport` surface, in CSS viewport pixels, clipped to visible scroll containers. `precision` defaults to `surface`. Returns `null` when the element is hidden.

## viewportPresenceTarget

```ts
function viewportPresenceTarget(
  element: Element,
  geometry: PresenceGeometry,
  precision?: PresenceTarget['precision'],
): PresenceTarget | null;
```

Returns geometry already in viewport coordinates, clipped to the visible part of `element`'s scroll containers. `precision` defaults to `exact`, and a partly visible target reports `region`. Returns `null` when the element is hidden.

## svgPresenceTarget

```ts
function svgPresenceTarget(
  element: SVGGraphicsElement,
  geometry: PresenceGeometry,
  precision?: PresenceTarget['precision'],
): PresenceTarget | null;
```

Returns geometry in an SVG element's coordinates, projected through its screen transform. `precision` defaults to `exact`. Returns `null` when the element is hidden.

## createElementPresenceResolver

```ts
function createElementPresenceResolver(resolve: (focus: VacpFocus) => Element | null): PresenceResolver;
```

Returns a resolver that maps a focus to an element and places it with [`elementPresenceTarget`](#elementpresencetarget).

## createRefPresentation

```ts
function createRefPresentation(root: Element, attribute?: string): PresencePresentation;
```

Returns a presentation for `presence.attach`. Its `resolve` points at the first element under `root` whose `attribute`, `data-vacp-ref` by default, holds the focus ref and that `elementPresenceTarget` places. Its `subscribe` measures again through [`observePresenceLayout`](#observepresencelayout) when `root` resizes or its content changes.

## observePresenceLayout

```ts
function observePresenceLayout(root: Element, invalidate: () => void): () => void;
```

Calls `invalidate` at most once per frame when `root` resizes or its content changes. Changes to paint attributes such as `fill` and `opacity` do not count. Returns a function that stops observing.

## paceAgentPresence

```ts
function paceAgentPresence(
  control: VacpExecutionControl,
  presence: PresenceArrival,
  options?: PresencePacing,
): () => void;
type PresencePacing = { arrivalTimeoutMs?: number; beforeExecuteMs?: number; afterExecuteMs?: number };
```

Lets one viewer pace the runtime through [execution gates](./runtime#vacpexecutioncontrol). Each execution the viewer shows waits for the cursor to arrive, then pauses, runs, and holds its result. Waits never change a result, and executions the viewer does not show never wait.

- `options.arrivalTimeoutMs`: the longest wait for the cursor. Default: `350`.
- `options.beforeExecuteMs`: the pause at the target before execution. Default: `0`.
- `options.afterExecuteMs`: how long the result holds before reaching the caller. Default: `0`.

Each value is between 0 and 60,000 milliseconds. Returns a function that removes the pacing. Throws for a value outside that range, and when the runtime or the viewer is disposed.

## PresenceArrival

```ts
type PresenceArrival = {
  readonly signal: AbortSignal;
  getSnapshot(): readonly PresenceActivity[];
  arrive(executionId: string, signal: AbortSignal): Promise<void>;
};
```

The part of an [`AgentPresence`](#agentpresence) that pacing reads.
