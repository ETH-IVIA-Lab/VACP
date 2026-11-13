# @ethivia/vacp-overlay

Draws each agent's cursor, its sentences, and the replay trail over your page for [agent presence](../presence/). The overlay renders with [React](https://react.dev) in its own shadow root, so your app adds no stylesheet.

```bash
pnpm add @ethivia/vacp-overlay react react-dom
```

`@ethivia/vacp-sdk` is also a peer dependency. [Install](../install/) adds it.

## createPresenceOverlay

```ts
createPresenceOverlay(runtime: PresenceSource, options?: Omit<PresenceOptions, 'renderer'> & { appearance?: PresenceAppearance }): AgentPresence
```

Creates a [presence viewer](./presence#createagentpresence) that draws with the overlay and resolves its targets again when the page or a nested container scrolls or the window resizes.

- `runtime` is the runtime to show, such as the `runtime` that `installVacpRuntime` returns.
- `options` takes the [`createAgentPresence` options](./presence#createagentpresence) other than `renderer`.
- `options.appearance` sets the overlay's [appearance](#appearance).

Disposing the runtime disposes the viewer. Throws when an appearance option is invalid, before it touches the document.

## Appearance

`PresenceAppearance` has these optional fields.

- `motion` sets how the cursor moves. `'system'` follows the reduced-motion setting, `'reduced'` places the cursor without movement, and `'full'` always moves it. Defaults to `'system'`.
- `durationMs` is the approximate settling time of a move. Defaults to `320`.
- `travel` grows the cursor by up to `scale` on long moves. Defaults to `{ scale: 1.6, minDistance: 80, fullDistance: 500 }`. `false` keeps its size.
- `cursor` sets `size`, `strokeWidth`, `stroke`, `fill`, and the [`assets` and `resolve`](#cursors) that pick its shape. Defaults to `{ size: 28, strokeWidth: 1.5, stroke: 'black' }`.
- `press` is the press on activation. Defaults to `{ scale: 0.8, durationMs: 260 }`. `false` turns it off.
- `ripple` is the ripple on activation. Defaults to `{ color: '#60a5fa', size: 64, durationMs: 400 }`. `false` turns it off.
- `bloom` is the glow behind an agent cursor. Defaults to `{ color: '#78b7ff', radius: 22 }`. `false` turns it off.
- `cue` is the outline of a target with `surface` precision. Defaults to `{ color: '#62666c', visible: true }`.
- `bubble` sets the bubble's `width`, at least 120, and its `icon`, which is stroked path data in a 24-unit square or `false`. Defaults to `{ width: 260 }` with a robot icon. `false` hides bubbles.
- `hover` is the drift while an agent thinks. Defaults to `{ distance: 2.5, periodMs: 2600 }`. `false` holds the cursor still.
- `text` is a [`PresenceText`](#presencetext) that renders the bubble's words. Defaults to plain text.
- `idlePosition` is `(viewport) => point`, where a cursor starts before it has a target.
- `describe` is `(activity, wording) => string`, which sets the bubble's words for every activity. `wording(activity)` returns the built-in wording, so call it for the activities you leave alone.
- `labels` replaces the overlay's [words](#labels). Defaults to English.
- `document` is the document to render into, such as an iframe's. Defaults to the global `document`.

## Labels

`labels` takes a partial `PresenceLabels`. Each key you supply replaces its default:

```ts
import { createPresenceOverlay } from '@ethivia/vacp-overlay';

const presence = createPresenceOverlay(runtime, {
  appearance: {
    labels: {
      step: (position, count) => `Schritt ${position} von ${count}`,
      agent: 'Assistenz',
      looking: (subject = 'die Ansicht') => `Betrachte ${subject}`,
    },
  },
});
```

These keys name frames, actors, and controls:

- `start`, `step(position, count)`, and `conclusion` name the first, step, and last frames. `position` counts from 1.
- `human`, `agent`, and `system` name each kind of actor. An actor's own `label` takes precedence.
- `trail` and `stepper` are the accessible names of the frame marks and of the navigation around them.
- `back`, `forward`, `live`, and `dismiss` are the step and close controls.
- `working` is the tooltip of the step controls while the agent works.
- `diverged` is the note under a frame that was partly restored.

The bubble shows these fallback sentences when a step carries no sentence from the agent:

- `before` and `after` appear on the first and last frames.
- `looking(subject?)` appears while the agent thinks, and after a step the view did not take.
- `leaving(subject?)` appears after a cancelled step.
- `refreshing(subject?)` appears while the view's outputs update.
- `applying(change, subject?)` and `applied(change, subject?)` appear during and after a step with a title.
- `updating(subject?)` and `updated(subject?)` appear during and after a step without a title.

`subject` is the name of the view the step works on, or `undefined` when the step names none. `change` is the title of the step's action.

A key set to `undefined` keeps its default. `createPresenceOverlay` and `createPresenceOverlayRenderer` throw when a function label receives anything else, or when a text label receives blank text.

## Cursors

`cursor.resolve(activity)` returns a `CursorPresentation`, `{ shape, activeShape?, feedback? }`. `activeShape` shows while the step runs, and `feedback: false` skips the press and ripple. `defaultCursorPresentation(activity)` maps `focus.interaction.kind` to the built-in shapes. Delegate to it for the kinds you leave alone:

```ts
import { createPresenceOverlay, defaultCursorPresentation } from '@ethivia/vacp-overlay';

const presence = createPresenceOverlay(runtime, {
  appearance: {
    cursor: {
      assets: { lasso: { path: 'M12 3a8 7 0 1 0 0 14c3 0 4 2 2 4', hotspot: { x: 12, y: 10 }, fill: 'none' } },
      resolve: (activity) =>
        activity.execution?.intent?.focus?.interaction?.kind === 'lasso'
          ? { shape: 'lasso' }
          : defaultCursorPresentation(activity),
    },
  },
});
```

`defaultCursorAssets` holds the built-in shapes: `arrow`, `pointer`, `crosshair`, `grab`, `grabbing`, `text`, `move`, `zoom`, `zoom-in`, `zoom-out`, `resize-x`, and `resize-y`. A `CursorAsset` is `{ path, hotspot, fill? }` in a 24-unit square. The hotspot stays on the target while the cursor scales and presses.

## streamdownText

```ts
import { streamdownText } from '@ethivia/vacp-overlay/streamdown';

createPresenceOverlay(runtime, { appearance: { text: streamdownText } });
```

A `PresenceText` that renders the bubble's words as Markdown with [Streamdown](https://streamdown.ai), a React renderer for incomplete Markdown. Add its optional peer with `pnpm add streamdown`.

It reveals each message a word at a time and renders emphasis, inline code, paragraphs, lists, and block quotes. Raw HTML stays literal text. Replayed messages and reduced motion render without animation.

## PresenceText

`{ View, speak? }`, which renders the bubble's words.

- `View` is a React component that receives `PresenceTextProps`: `text`, `revision`, `streaming`, `animate`, and `reducedMotion`. A message keeps its `revision` while it grows, and a different `revision` replaces it.
- `speak(text)` returns the words a screen reader announces once the message settles.

## createPresenceOverlayRenderer

```ts
createPresenceOverlayRenderer(appearance?: PresenceAppearance): PresenceRenderer
```

Returns the overlay alone, for a host that creates its viewer with [`createAgentPresence`](./presence#createagentpresence).
