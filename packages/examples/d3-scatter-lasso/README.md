# D3 Scatter + Lasso (frameworkless VACP provider)

This example is intentionally “boring tech”:

- no framework (just TypeScript + Vite)
- plain D3 rendering

…and still fully agent-ready via a VACP bridge at `window.__vacp`.

It’s meant to show that VACP is **not tied to Mosaic or Vega-Lite**. If you can describe your UI as a graph + actions + state, you can make it controllable.

## Run it

From the `vacp/` repo root:

```bash
pnpm -C packages/examples/d3-scatter-lasso dev
```

Enable the debug overlay:

- add `?vacpDebug=1` to the URL, then click the floating **VACP** button

## What happens (end-to-end)

1. The app renders a scatter plot in SVG.
2. Human lasso input is captured in pixel space, then converted to **domain coordinates**.
3. `installVacpForD3ScatterLasso(...)` installs VACP:
   - builds a small graph (“View” → “Visualization” → “InteractionTarget”)
   - stores the lasso polygon as state (`Selection`-like node)
   - registers semantic actions:
     - `vanilla.set_lasso_polygon` (set polygon in domain coordinates)
     - `vanilla.clear_lasso`
     - `vacp.apply_state` (dev-only “apply this state map” helper)
   - annotates the SVG and embeds the graph via `<metadata type="application/vacp+json">…</metadata>`
   - installs/updates `window.__vacp` using `@vacp/gateway`

## Things to try

### Human interaction (mouse)

- Draw a freehand polygon in the plot area.
- The selected points update immediately.
- Open the debug overlay and watch:
  - state (selection polygon)
  - history entries (human vs debug vs agent sources)

### Agent-like interaction (semantic actions)

Use the page buttons or the debug overlay:

- **Demo: set lasso** runs `vanilla.set_lasso_polygon`
- **Clear lasso** runs `vanilla.clear_lasso`
- Debug overlay → **Actions** lets you dispatch the same calls with custom parameters

The point: the “human lasso” and the “semantic action” mutate the same underlying state shape.

## Useful entry points

- App wiring + D3 rendering: `src/app.ts`
- VACP provider implementation: `src/vacp_integration.ts`
