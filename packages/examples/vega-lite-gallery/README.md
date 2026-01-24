# Vega-Lite gallery

VACP + Vega-Lite params.

This example exposes Vega-Lite charts through VACP by mapping Vega-Lite `params` to a bridge at `window.__vacp` (unless
`?expose-bridge=0`).

Use this example to see:

- parameter-driven charts (sliders, toggles, etc.)
- selection parameters (brushes, point selections)
- linked views (one view drives another via shared params)

## Run it

From the repo root:

```bash
pnpm -C packages/examples/vega-lite-gallery dev
```

Enable the debug overlay:

- set `VACP_DEBUG_UI=1` or add `?vacp-debug=1` to the URL, then click the floating **VACP** button

## How it works

1. The app picks a spec from `src/specs/*.vl.json`.
2. `vega-embed` renders it to **SVG** and returns a Vega View.
3. `@vacp/vega-lite` installs VACP:
   - **Bridge**: installs/updates `window.__vacp` (capabilities/state/execute, unless `?expose-bridge=0`)
   - **Graph**: creates nodes for:
     - `Param` (a named Vega-Lite parameter)
     - `Selection` (selection-valued parameters)
   - **Actions**:
     - `vega_lite.set_param` (set a param value)
     - `vega_lite.clear_selection` (clear a selection param, when present)
     - `vacp.apply_state` (dev-only “apply this state map” helper)

Agents can set params and clear selections through semantic actions, without DOM scraping or pixel automation.

## Things to try

### Try it: human interaction

- Interact with the charts:
  - **brush → detail**: drag a brush in the scatterplot; the right view updates
  - **brush → origin summary (click to pin)**: brush the scatterplot to recompute origin counts; click bars to pin/highlight one or more origins
- Watch:
  - `window.__vacp.getState()` updates
  - debug overlay → **History** changes

### Try it: agent-style actions

Use the overlay:

- Debug overlay → **Playbook** → **Run all**
- Debug overlay → **Actions** to call `vega_lite.set_param` / `vega_lite.clear_selection` manually

## How to add or edit specs

Specs live in `src/specs/*.vl.json` and are loaded as JSON.

Datasets should be placed under `public/data/` so Vega-Lite `data.url: "data/..."` resolves as `/data/...` when the app
is running.

## How bidirectionality is achieved

- **Human** interaction updates Vega signals/params through Vega’s runtime.
- `@vacp/vega-lite` reads those param values and exposes them via `window.__vacp.getState()`.
- **Agent** calls `vega_lite.set_param` / `vega_lite.clear_selection`, which updates Vega signals directly.
- Both paths are recorded in the VACP runtime history so debugging/time travel works uniformly.

## Useful entry points

- App wiring: `src/app.ts`
- Playbook scripts: `src/playbooks.ts`
- Spec gallery loader: `src/gallery.ts`
- Specs: `src/specs/`
