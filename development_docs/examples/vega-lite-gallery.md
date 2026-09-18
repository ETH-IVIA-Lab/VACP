# Vega-Lite gallery

VACP + Vega-Lite *Param*s.

This example exposes Vega-Lite charts through VACP by mapping Vega-Lite *Param*s to a bridge at `window.__vacp` (unless
`exposeBridge: false`).

Use this example to see:

- _Param_-driven charts (sliders, toggles, etc.)
- _Selection_ parameters (brushes, point selections)
- linked *View*s (one _View_ drives another via shared *Param*s)

## Run it

From the repo root:

```bash
pnpm -C examples/vega-lite-gallery dev
```

Open the inspector:

- click the floating **VACP** button. Applications choose whether to call `installVacpInspector()`

## How it works

1. The app picks a spec from `src/specs/*.vl.json`.
2. `vega-embed` renders it to **SVG** and returns a Vega _View_.
3. `@vacp/adapter-vega-lite` installs VACP:
   - **Bridge**: installs/updates `window.__vacp` (capabilities/state/execute, unless `exposeBridge: false`)
   - **Graph**: creates nodes for:
     - _Param_ (a named Vega-Lite parameter)
     - _Selection_ (selection-valued parameters)
   - **Actions**:
     - `vega_lite.set_param` (set a param value)
     - `vega_lite.clear_selection` (clear a selection param, when present)
     - `vacp.apply_state` (applies a state map from the inspector during local inspection)

Agents can set *Param*s and clear *Selection*s through semantic actions, without DOM scraping or pixel automation.

## Things to try

### Try it: human interaction

- Interact with the charts:
  - **brush -> detail**: drag a brush in the scatterplot. The right view updates
  - **brush -> origin summary (click to pin)**: brush the scatterplot to recompute origin counts. Click bars to pin or highlight one or more origins
- Watch:
  - `window.__vacp.getState()` updates
  - inspector -> **History** changes

### Try it: agent-style actions

Use the overlay:

- Inspector -> **Actions** to call `vega_lite.set_param` / `vega_lite.clear_selection` manually

## How to add or edit specs

Specs live in `src/specs/*.vl.json` and are loaded as JSON.

Datasets should be placed under `public/data/` so Vega-Lite `data.url: "data/..."` resolves as `/data/...` when the app
is running.

## How bidirectionality is achieved

- **Human** interaction updates Vega signals/*Param*s through Vega's runtime.
- `@vacp/adapter-vega-lite` reads those _Param_ values and exposes them via `window.__vacp.getState()`.
- **Agent** calls `vega_lite.set_param` / `vega_lite.clear_selection`, which updates Vega signals directly.
- Both paths are recorded in the VACP runtime history so debugging/time travel works uniformly.

## Entry points

- App wiring: `src/app.ts`
- Spec gallery loader: `src/gallery.ts`
- Specs: `src/specs/`

Local URL: `https://vega-lite.examples.vacp.localhost/`. Portless prints the exact URL when using a custom proxy port or git worktree.
