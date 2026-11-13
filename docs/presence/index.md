# Agent presence

Presence shows the person what an agent does. A cursor travels to the control or mark each step changes, and a bubble beside it shows the agent's sentence for the step. It follows every agent call the runtime executes, whether it arrives through MCP, the AI SDK tools, or WebMCP.

```bash
pnpm add @ethivia/vacp-overlay react react-dom
```

```ts
import { createPresenceOverlay } from '@ethivia/vacp-overlay';
import { createVegaLitePresentation } from '@ethivia/vacp-vega';

const presence = createPresenceOverlay(runtime);
presence.attach(provider, createVegaLitePresentation(provider));

// When the view unmounts:
presence.dispose();
```

The overlay works in a page written with any framework. It renders with React internally, so install `react` and `react-dom` even when your app uses neither. `runtime` comes from `const { runtime } = installVacpRuntime(...)`. `createPresenceOverlay` renders the overlay into its own [shadow root](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM), so it adds no stylesheet to your page and leaves clicks, focus, and scrolling to the person. `attach` takes one provider and its [presentation](../concepts/#presence), which tells presence where the provider's entities appear on screen. `provider` is your [Vega-Lite provider](../vega-lite/), created with the `root` element the chart renders into. Disposing the runtime also removes the overlay.

Presence shows agents. Changes by a person or the system go to [provenance](../provenance/) without a cursor.

## Attach a Mosaic view

For a [Mosaic vgplot](../vgplot/) dashboard, attach the provider with the vgplot presentation:

```ts
import { createVgplotPresentation } from '@ethivia/vacp-vgplot';

presence.attach(provider, createVgplotPresentation(provider));
```

`attach` returns a function that detaches the provider. Removing or replacing the provider in the runtime detaches it as well.

## Point at your own controls

For a provider you write yourself, mark the element that shows each ref with `data-vacp-ref`, and point presence at the marked elements:

```ts
import { createRefPresentation } from '@ethivia/vacp-sdk/presence';

// <form id="settings"><input type="range" data-vacp-ref="vacp://example/threshold" /></form>
const settings = document.querySelector('#settings')!;

presence.attach(provider, createRefPresentation(settings));
```

`createRefPresentation` points at the first rendered element under `settings` that carries the step's focus ref, and measures again when `settings` resizes or its content changes. The action names its focus with `.focus(() => ({ ref }))`, as in [Describe actions](../custom-provider/#describe-actions). Add `interaction: { kind: 'drag' }` to the focus to choose the cursor shape.

When an element depends on more than the ref, such as a list item picked by the focus `detail`, pass your own lookup to `createElementPresenceResolver((focus) => element)`. A canvas or WebGL view implements a `PresenceResolver` that returns a point or a region in viewport coordinates. Pass `onUnplaced(activity)` to `createPresenceOverlay` to log the steps presence could not place. The [presence reference](../api/presence) lists the target helpers.

## Let the person replay the steps

Pass a replay controller, and after a request the person can step back through the agent's checkpoints from the bubble:

```ts
import { createProvenanceReplay, createVacpRestorer } from '@ethivia/vacp-sdk';

const replay = createProvenanceReplay(runtime, { restore: createVacpRestorer(runtime) });
const presence = createPresenceOverlay(runtime, { replay });

// When the view unmounts:
presence.dispose();
replay.dispose();
```

Hovering or focusing the bubble shows back and forward arrows and a rail with one mark per step. Selecting a step restores every view through its source's `vacp.apply_state` action. The Vega-Lite and vgplot providers register it, and [Restore recorded state](../custom-provider/#restore-recorded-state) adds it to your own provider. New work by the person or the agent ends the review and keeps the new state. Presence never disposes the controller. [Provenance and replay](../provenance/) covers the controller itself.

## Pace the steps

An agent's steps run as fast as it calls them. `paceAgentPresence` holds each step so the person can follow it:

```ts
import { paceAgentPresence } from '@ethivia/vacp-sdk/presence';

const stopPacing = paceAgentPresence(runtime, presence, {
  arrivalTimeoutMs: 900,
  beforeExecuteMs: 320,
  afterExecuteMs: 1200,
});
```

Each agent step waits up to `arrivalTimeoutMs` for the cursor to reach its target, pauses `beforeExecuteMs`, runs, and holds the result for `afterExecuteMs`. Only steps this overlay shows wait, so a person's own input never slows down. A `window.__vacp.execute` call from the console runs as the agent, so it waits too. Call `stopPacing()` to remove the pauses.

## Render Markdown in the bubble

```bash
pnpm add streamdown
```

```ts
import { streamdownText } from '@ethivia/vacp-overlay/streamdown';

const presence = createPresenceOverlay(runtime, { appearance: { text: streamdownText } });
```

[Streamdown](https://streamdown.ai) renders Markdown that arrives in pieces. `streamdownText` reveals each sentence word by word as streamed Markdown. Without it the bubble shows plain text.

## Change the look

`appearance` sets the overlay's size, colors, motion, and words:

```ts
const presence = createPresenceOverlay(runtime, {
  appearance: { bubble: { width: 290 }, cursor: { size: 24 }, labels: { dismiss: 'Schließen' } },
});
```

`labels` translates the overlay's controls and the sentences it writes for steps the agent did not narrate. The overlay follows the person's reduced-motion setting. The [overlay reference](../api/overlay) lists every option with its default. To draw presence with your own renderer, use `createAgentPresence` from the [presence reference](../api/presence).

## Next

- [Provenance and replay](../provenance/)
- [Connect an agent](../agents/)
