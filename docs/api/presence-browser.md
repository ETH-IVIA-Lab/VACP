# @ethivia/vacp-presence-react

The browser overlay for [agent presence](../presence/): a cursor per agent, a bubble with its sentences, and the replay trail. It renders with React into its own shadow root, styled by compiled [StyleX](https://stylexjs.com) rules it adopts into that root, so the application adds no stylesheet. The overlay hides when the page prints, whatever print styles the application sets.

## createBrowserPresence

```ts
createBrowserPresence(runtime: PresenceSource, options?: PresenceOptions & { appearance?: BrowserPresenceOptions }): AgentPresence
```

Creates a [`createAgentPresence`](./presence-core#createagentpresence) viewer with the browser renderer, and resolves targets again when the page or a nested container scrolls or the window resizes. Disposing the runtime disposes the viewer. Throws when an appearance option is invalid, before touching the document.

## Appearance

| Option         | Default                                              | Meaning                                                                                                                        |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `motion`       | `'system'`                                           | `'system'` follows reduced motion, `'reduced'` places without movement, `'full'` always moves                                  |
| `durationMs`   | 320                                                  | Approximate settling time of a move                                                                                            |
| `travel`       | `{ scale: 1.6, minDistance: 80, fullDistance: 500 }` | The cursor grows by up to `scale` on long moves. `false` keeps its size                                                        |
| `cursor`       | `{ size: 28, strokeWidth: 1.5, stroke: 'black' }`    | `fill`, `assets`, and `resolve` customize the cursor                                                                           |
| `press`        | `{ scale: 0.8, durationMs: 260 }`                    | The press on activation. `false` turns it off                                                                                  |
| `ripple`       | `{ color: '#60a5fa', size: 64, durationMs: 400 }`    | The ripple on activation. `false` turns it off                                                                                 |
| `bloom`        | `{ color: '#78b7ff', radius: 22 }`                   | The glow behind an agent cursor. `false` turns it off                                                                          |
| `cue`          | `{ color: '#62666c', visible: true }`                | The dashed outline of a surface-precision target                                                                               |
| `bubble`       | `{ width: 260 }`                                     | The bubble's width, at least 120, and `icon`: stroked path data in a 24-unit square, or `false`. `bubble: false` hides bubbles |
| `hover`        | `{ distance: 2.5, periodMs: 2600 }`                  | The quiet drift while an agent thinks. `false` holds still                                                                     |
| `text`         | Plain text                                           | A `PresenceText` that renders the bubble's words                                                                               |
| `idlePosition` |                                                      | `(viewport) => point`: where a cursor starts before it has a target                                                            |
| `describe`     | Built-in wording                                     | `(activity) => string`: the bubble's status line                                                                               |
| `labels`       | English wording                                      | The overlay's frame names, speaker names, controls, and notes. See [Labels](#labels)                                           |
| `document`     | `document`                                           | The document to render into, such as an iframe's                                                                               |

## Labels

`labels` takes a partial `PresenceLabels` object with the words the overlay draws and announces around the agent's sentences. Each supplied label replaces its default:

```ts
const presence = createBrowserPresence(runtime, {
  replay,
  appearance: {
    labels: {
      start: 'Anfang',
      step: (position, count) => `Schritt ${position} von ${count}`,
      conclusion: 'Ergebnis',
      agent: 'Assistenz',
      back: 'Vorheriger Schritt',
      forward: 'Nächster Schritt',
      live: 'Zurück zur aktuellen Ansicht',
    },
  },
});
```

| Label                      | Default                                                   | Where it appears                                                                                             |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `start`                    | `'Start'`                                                 | The first frame's name, as the bubble heading and on its trail mark                                          |
| `step`                     | `` (position, count) => `Step ${position} of ${count}` `` | A step frame's name. `position` counts from 1, and `count` is the number of steps                            |
| `conclusion`               | `'Conclusion'`                                            | The last frame's name                                                                                        |
| `human`, `agent`, `system` | `'You'`, `'Agent'`, `'System'`                            | The name of each kind of actor, in screen reader announcements and in the heading of a human or system actor |
| `trail`                    | `'Request trail'`                                         | The accessible name of the group of frame marks                                                              |
| `stepper`                  | `'Trail controls'`                                        | The accessible name of the navigation around the step and close controls                                     |
| `back`, `forward`          | `'Previous step'`, `'Next step'`                          | The step controls                                                                                            |
| `live`                     | `'Return to the live view'`                               | The close control during a review                                                                            |
| `dismiss`                  | `'Dismiss'`                                               | The close control of a retained step                                                                         |
| `working`                  | `'Stepping resumes when the agent finishes'`              | The tooltip of the step controls and the other frame marks while the agent works                             |
| `diverged`                 | `'The view may differ slightly from the recording.'`      | The note under a frame that was only partly restored                                                         |

`step` takes a function, and every other label takes nonblank text. A label set to `undefined` keeps its default. `createBrowserPresence` and `createBrowserPresenceRenderer` throw on any other value.

An actor's own `label` takes precedence over `human`, `agent`, and `system`.

`describe` sets the bubble's words for every activity. The built-in wording shows the agent's sentence, or an English description of the step when the agent wrote none.

## Cursors

`cursor.resolve(activity)` returns `{ shape, activeShape?, feedback? }`. `activeShape` shows while the step runs, and `feedback: false` skips the press and ripple. `defaultCursorPresentation(activity)` maps `focus.interaction.kind` to the built-in shapes. Delegate to it for the kinds you leave alone:

```ts
const presence = createBrowserPresence(runtime, {
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

`defaultCursorAssets` holds the built-in shapes: `arrow`, `pointer`, `crosshair`, `grab`, `grabbing`, `text`, `move`, `zoom`, and the resize arrows. A `CursorAsset` is `{ path, hotspot, fill? }` in a 24-unit square. The hotspot stays on the target while the cursor scales and presses.

## Streamed text

```ts
import { streamdownText } from '@ethivia/vacp-presence-react/streamdown';

createBrowserPresence(runtime, { appearance: { text: streamdownText } });
```

`streamdownText` renders the bubble's words as Markdown with [Streamdown](https://streamdown.ai), revealing a new message a word at a time and repairing incomplete Markdown as it arrives. It renders emphasis, inline code, paragraphs, and lists, and keeps raw HTML as literal text. Replayed messages and reduced motion render without animation. Screen readers receive the full message once it settles.

A custom `PresenceText` is `{ View, speak? }`. `View` is a React component that receives `text`, `revision`, `streaming`, `animate`, and `reducedMotion`. A new `revision` replaces the message, and the same revision only grows. `speak(text)` returns the words a screen reader announces.

## createBrowserPresenceRenderer

```ts
createBrowserPresenceRenderer(appearance?: BrowserPresenceOptions): PresenceRenderer
```

The renderer alone, for a host that creates its viewer with `createAgentPresence`.
