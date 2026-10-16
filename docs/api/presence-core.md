# @vacp/presence-core

Headless agent presence: which actors are active, what each step targets, where its target is on screen, and how replay frames are navigated. [`@vacp/presence-browser`](./presence-browser) renders it in the browser. The [Agent presence guide](../presence/) shows the common setups.

## createAgentPresence

```ts
createAgentPresence(runtime: PresenceSource, options?: PresenceOptions): AgentPresence
```

| Option            | Default     | Meaning                                                                                               |
| ----------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `renderer`        |             | `{ render(frame), arrive?(executionId, signal), dispose?() }`                                         |
| `includeActor`    | Agents only | Which actors appear, live and in replay                                                               |
| `replay`          |             | A [provenance replay controller](./provenance) presence navigates and never disposes                  |
| `maxActors`       | 4           | Actors shown at once                                                                                  |
| `lingerMs`        | 1600        | How long a finished step stays before its frame retires                                               |
| `narrationHoldMs` | 2000        | How long a sentence that arrives between steps waits for the next step to begin. `0` shows it at once |
| `onError`         |             | Receives renderer, resolver, and subscription failures                                                |

`PresenceSource` is the part of the runtime presence reads: executions, agent activity, snapshots, and `getProviderBinding`. Presence never executes anything.

| Member                           | Behavior                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `attach(provider, presentation)` | Resolves the provider's targets through `presentation` while its binding lives. Returns a detach function |
| `getSnapshot()`                  | The live activities                                                                                       |
| `subscribe(listener)`            | Notifies when live activities change                                                                      |
| `invalidateTargets()`            | Resolves every shown target again, such as after a resize                                                 |
| `arrive(executionId, signal)`    | Resolves when the renderer reports the cursor at the step's target                                        |
| `signal`                         | Aborted by `dispose()`                                                                                    |
| `dispose()`                      | Releases subscriptions, targets, and the renderer                                                         |

### Frames

```ts
type PresenceFrame = {
  activities: readonly PresenceActivity[];
  reason: 'activity' | 'layout';
  navigation?: PresenceNavigation;
};
type PresenceActivity = {
  actor: VacpActor;
  phase: 'thinking' | 'acting' | 'completed' | 'failed' | 'cancelled' | 'reviewing';
  summary?: string;
  frame?: 'start' | 'step' | 'conclusion';
  recordId?: string;
  activityId?: string;
  subject?: string;
  execution?: VacpExecution;
  target: PresenceTarget | null;
  freshness: 'unknown' | 'updating' | 'current' | 'error';
};
```

The renderer receives a frame for every change to live, retained, or replayed presentation. `reason: 'layout'` means only target geometry moved. `summary` is the step's or turn's sentence. `subject` names the view the step works on. `freshness` is `current` only when the provider reported a current output for the step's target.

`navigation` lists the shown request's `frames` with the shown `index`, `canBack`, `canForward`, `reviewing`, `restoring`, `working`, and `diverged`, and the callbacks `go(index)`, `back()`, `forward()`, and `close()`. While `working` is true, `canBack` and `canForward` are false and step calls do nothing, so call again once the work settles.

## Targets

```ts
type PresenceResolver = (
  focus: VacpFocus,
  options: { signal: AbortSignal },
) => PresenceTarget | null | Promise<PresenceTarget | null>;
type PresencePresentation = { resolve: PresenceResolver; subscribe?(invalidate: () => void): () => void };
type PresenceTarget = { surface: string; geometry: PresenceGeometry; precision: 'exact' | 'region' | 'surface' };
type PresenceGeometry =
  | { kind: 'point'; point: { x: number; y: number } }
  | { kind: 'region'; x: number; y: number; width: number; height: number }
  | { kind: 'path'; points: readonly { x: number; y: number }[] };
```

A resolver returns `null` when it cannot place the focus. Presence calls `subscribe` only while a pointer or a recorded frame rests on the provider, and releases it when none does. `presenceAnchor(geometry)` returns the point a cursor rests on.

## @vacp/presence-core/dom

Browser geometry for resolvers, in CSS viewport pixels on the `viewport` surface, clipped to visible scroll containers.

| Function                                                | Returns                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementPresenceTarget(element, precision?)`            | The element's box, `surface` precision by default                                                                                                                       |
| `viewportPresenceTarget(element, geometry, precision?)` | Geometry already in viewport coordinates, clipped to the visible part of `element`'s scroll containers                                                                  |
| `svgPresenceTarget(element, geometry, precision?)`      | Geometry in an SVG element's coordinates, through its screen transform                                                                                                  |
| `createElementPresenceResolver(resolve)`                | A resolver that maps a focus to an element                                                                                                                              |
| `observePresenceLayout(root, invalidate)`               | Calls `invalidate` at most once per frame when `root` resizes or its content changes. Paint-only attribute changes are ignored. Returns a function that stops observing |

Each target function returns `null` when the element is hidden.

## paceAgentPresence

```ts
paceAgentPresence(control: VacpExecutionControl, presence: PresenceArrival, timing?: {
  arrivalTimeoutMs?: number; // default 350
  beforeExecuteMs?: number;  // default 0
  afterExecuteMs?: number;   // default 0
}): () => void
```

Grants a viewer pacing authority over the runtime. Each execution the viewer shows waits for the cursor to arrive, at most `arrivalTimeoutMs`, then `beforeExecuteMs`, runs, and holds its result for `afterExecuteMs`. Each value is between 0 and 60,000 ms. Waits never change a result, and executions the viewer does not show never wait. Returns a function that removes the pacing.
