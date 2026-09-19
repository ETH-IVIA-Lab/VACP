# Agent presence

Show where an agent acts with a cursor, target cues, and execution status. Actions run immediately by default. Presence follows the runtime, including actions invoked through MCP and WebMCP.

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
presence.attach(provider, createVegaLitePresentation(config));

// On unmount:
presence.dispose();
installation.dispose();
```

For VGPlot, use `createVgplotPresentation` from `@vacp/adapter-vgplot/presentation`. Pass the same `root`, `plots`, `tables`, and `options` used to create its provider. Bindings follow provider generations. Replacing or detaching a provider releases its targets and pending lookups.

The default cursor uses the inline SVG geometry from agent-browser: a white pointer with a black outline. It compresses briefly and emits a blue ripple when an action activates at its target. The overlay leaves application pointer events, keyboard focus, and scrolling under human control. Missing or offscreen geometry produces textual activity. A dashed target cue indicates surface-level precision.

## Customize appearance and timing

```ts
const presence = createBrowserPresence(runtime, {
  maxActors: 3,
  lingerMs: 1800,
  appearance: {
    motion: 'system',
    durationMs: 220,
    cursor: { size: 28, fill: 'white', stroke: 'black', strokeWidth: 1.5 },
    press: { scale: 0.8, durationMs: 260 },
    ripple: { color: '#60a5fa', size: 64, durationMs: 400 },
    cue: { color: '#62666c', visible: true },
    labels: false,
  },
});
```

`motion: 'system'` respects reduced-motion preferences. Use `reduced` for static positioning or `full` to explicitly enable movement. `cursor.path` accepts an SVG path in a 24-unit coordinate system. `appearance.describe(activity)` controls status wording, and `appearance.document` selects the owning document for an iframe or another window.

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

`arrivalTimeoutMs` bounds target resolution and cursor travel. `beforeExecuteMs` pauses before the handler starts. `afterExecuteMs` holds the completed result before returning it, so a caller awaiting consecutive actions has time to observe each change. Execution status and freshness remain live during these pauses. Concurrent calls remain concurrent.

Creating a viewer alone never changes execution timing. Calling `paceAgentPresence` with `{}` waits up to 350 ms for arrival, with no intentional pauses. Each timing option accepts 0 to 60,000 ms. Missing geometry skips the approach, while configured pauses still apply. Disposal releases presentation waits. Cancellation before execution prevents the action. Cancellation during the final pause releases the already-completed runtime result and preserves its history.

Set `press: false` or `ripple: false` under `appearance` to disable either effect. Reduced motion replaces scaling and ripple expansion with a short static target ring. The ripple acknowledges semantic activity, and does not signal output freshness.

## Bind custom actions

Describe the intentional focus after parameter parsing:

```ts
actions
  .operation('mutation', 'threshold.set', 'Set threshold')
  .title('Set threshold')
  .params(parameterDescription, thresholdParser)
  .focus(({ value }) => ({ ref: thresholdRef, detail: { value } }))
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

## Build another inspection surface

`@vacp/presence-core` runs independently of browser APIs:

```ts
import { createAgentPresence } from '@vacp/presence-core';

const presence = createAgentPresence(runtime, {
  renderer: {
    render: (activities) => renderActivityFeed(activities),
    dispose: () => clearActivityFeed(),
  },
});

presence.attach({
  ...runtime.getProviderBinding(provider),
  sourceId: provider.source.id,
  resolve: resolveLocalTarget,
});
```

Omit `renderer` and use `getSnapshot()` and `subscribe(listener)` when the consuming UI owns rendering. Each viewer has independent activity and cleanup. Visual bursts coalesce per actor while the runtime retains every execution event.

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
