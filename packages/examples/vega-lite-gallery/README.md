# Vega-Lite Gallery (VACP + Vega-Lite params)

This example turns Vega-Lite charts into an **agent-ready** app by exposing Vega-Lite `params` through a VACP bridge at `window.__vacp`.

It’s a good starting point if you care about:

- parameter-driven charts (sliders, toggles, etc.)
- selection parameters (brushes, point selections)
- linked views (one view drives another via shared params)

## Run it

From the `vacp/` repo root:

```bash
pnpm -C packages/examples/vega-lite-gallery dev
```

Enable the debug overlay:

- add `?vacpDebug=1` to the URL, then click the floating **VACP** button

## What happens (end-to-end)

1. The app picks a spec from `src/specs/*.ts`.
2. `vega-embed` renders it to **SVG** and returns a Vega View.
3. `@vacp/vega-lite` installs VACP:
   - **Bridge**: installs/updates `window.__vacp` (capabilities/state/execute)
   - **Graph**: creates nodes for:
     - `Param` (a named Vega-Lite parameter)
     - `Selection` (selection-valued parameters)
   - **Actions**:
     - `vega_lite.set_param` (set a param value)
     - `vega_lite.clear_selection` (clear a selection param, when present)
     - `vacp.apply_state` (dev-only “apply this state map” helper)

The key promise: an agent can manipulate interactive Vega-Lite charts **without** DOM scraping or pixel dragging.

## Things to try

### Human interaction (mouse)

- Click or brush in the chart (depending on the spec).
- If a slider is present, move it.
- Watch:
  - `window.__vacp.getState()` updates
  - debug overlay → **History** changes

### Agent-like interaction (semantic actions)

Use the page buttons:

- **Demo: set param**: increments a param value (chooses the first `Param` node)
- **Demo: clear selection**: clears a selection param (chooses the first `Selection` node)

Or use the overlay:

- Debug overlay → **Demo** → **Run all**

## How to add or edit specs

Specs live in `src/specs/*.ts`. Each module exports:

- `meta`: `{ id, title, description }`
- `createSpec()`: returns a Vega-Lite spec object

Example shape:

```ts
export const meta = { id: 'scatter-params', title: 'Scatter + param slider' };
export function createSpec() {
  return {
    /* Vega-Lite spec */
  };
}
```

## How bidirectionality is achieved

- **Human** interaction updates Vega signals/params through Vega’s runtime.
- `@vacp/vega-lite` reads those param values and exposes them via `window.__vacp.getState()`.
- **Agent** calls `vega_lite.set_param` / `vega_lite.clear_selection`, which updates Vega signals directly.
- Both paths are recorded in the VACP runtime history so debugging/time travel works uniformly.

## Useful entry points

- App wiring: `src/app.ts`
- Demo scripts: `src/demos.ts`
- Spec gallery loader: `src/gallery.ts`
- Specs: `src/specs/`
