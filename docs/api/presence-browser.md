# @ethivia/vacp-presence-browser

The browser overlay for [agent presence](../presence/): a cursor per agent, a bubble with its sentences, and the replay trail. It renders with React into its own shadow root, styled by compiled [StyleX](https://stylexjs.com) rules it adopts into that root, so the application adds no stylesheet.

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
| `document`     | `document`                                           | The document to render into, such as an iframe's                                                                               |

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
import { streamdownText } from '@ethivia/vacp-presence-browser/streamdown';

createBrowserPresence(runtime, { appearance: { text: streamdownText } });
```

`streamdownText` renders the bubble's words as Markdown with [Streamdown](https://streamdown.ai), revealing a new message a word at a time and repairing incomplete Markdown as it arrives. It renders emphasis, inline code, paragraphs, and lists, and keeps raw HTML as literal text. Replayed messages and reduced motion render without animation. Screen readers receive the full message once it settles.

A custom `PresenceText` is `{ View, speak? }`. `View` is a React component that receives `text`, `revision`, `streaming`, `animate`, and `reducedMotion`. A new `revision` replaces the message, and the same revision only grows. `speak(text)` returns the words a screen reader announces.

## createBrowserPresenceRenderer

```ts
createBrowserPresenceRenderer(appearance?: BrowserPresenceOptions): PresenceRenderer
```

The renderer alone, for a host that creates its viewer with `createAgentPresence`.
