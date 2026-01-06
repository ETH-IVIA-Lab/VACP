# VACP Architecture

This document explains how the `vacp/` monorepo is structured, how the runtime system works end-to-end, and why the design is “Mosaic-first but reusable”.

---

## Goals

- **Make visual analytics UIs agent-ready** without pixel-based “computer use”.
- Provide a stable, typed interface for agents:
  - **Discovery**: “what exists / what can I do?”
  - **State**: “what is selected / configured right now?”
  - **Control**: “execute this interaction safely with parameters”
- Keep the protocol **standalone** and reusable across apps, while supporting **first-class Mosaic/vgplot** integrations.

---

## Key Idea: VACP as a Graph + Actions (DOM is an adapter)

VACP’s canonical representation is:

- A **graph** of nodes and edges describing UI structure and semantics.
- A list of **action descriptors** (callable interactions) with parameter schemas.
- A **state snapshot** keyed by stable node references.

DOM/SVG annotations are used for:

- discoverability and debugging,
- compatibility with non-cooperative apps (fallback),
- linking nodes to rendered SVG output.

But the preferred, stable integration path is a **window bridge** (`window.__vacp`) that returns canonical JSON snapshots directly.

---

## Monorepo Layout

The monorepo uses:

- **pnpm** for TypeScript packages in `vacp/packages/*`
- **uv** for Python packages in `vacp/packages/server/*`

### TypeScript packages

- `vacp/packages/core` (`@vacp/core`)
  - Protocol types and contracts:
    - graph model (`VacpGraph`, `VacpNode`, `VacpEdge`)
    - actions (`VacpActionDescriptor`, `VacpActionCall`, `VacpActionResult`)
    - snapshots (`VacpCapabilitiesSnapshot`, `VacpStateSnapshot`)
    - in-page bridge contract (`VacpWindowBridge`)
- `vacp/packages/gateway` (`@vacp/gateway`)
  - Action execution runtime:
    - `VacpActionRegistry` (register/execute)
    - `createVacpWindowBridge` + `installVacpWindowBridge` (exposes `window.__vacp`)
- `vacp/packages/dom` (`@vacp/dom`)
  - DOM/SVG adapter:
    - `applyVacpAttributes` / `applyVacpInteractionAttributes` (`data-vacp-*`, `data-interaction-vacp-*`)
    - `embedVacpGraphInSvg` via `<metadata type="application/vacp+json">`
- `vacp/packages/mosaic` (`@vacp/mosaic`)
  - Mosaic/vgplot-first integration:
    - `installVacpOnVgplot(plot, svg, options)`:
      - annotates SVG + mark groups (`[data-index]`)
      - embeds the canonical graph in SVG metadata
      - installs `window.__vacp`
      - registers minimal actions for vgplot interactors (Interval1D/Interval2D)
- `vacp/packages/vega-lite` (`@vacp/vega-lite`)
  - Vega-Lite-first integration:
    - `installVacpOnVegaLiteView({ root, view, spec, options })`
    - Exposes Vega-Lite `params` as VACP nodes:
      - variable params → `Param` nodes (ConfigLayer)
      - selection params → `Selection` nodes (InteractionFeedbackLayer)
    - Registers actions to set/clear params by name (implemented via Vega View signals)
    - Installs an in-page bridge (`window.__vacp`) for stable access
- `vacp/packages/debug-ui` (`@vacp/debug-ui`)
  - Optional in-app debug overlay:
    - gated by `?vacpDebug=1` / localStorage `vacp:debug=1`
    - renders the current graph to SVG using Mermaid (on demand)

### Python packages

- `vacp/packages/server/vacp-mcp-server` (`vacp-mcp-server`)
  - Runs Playwright, exposes MCP tools for:
    - `vacp_capabilities()`
    - `vacp_state()`
    - `vacp_execute(name, params, call_id)`
  - Uses a **Surface** abstraction:
    - preferred: bridge-based (calls `window.__vacp`)
    - fallback: DOM scan + SVG metadata extraction

---

## Package Dependency Overview

```mermaid
flowchart TB
  subgraph TS["TypeScript workspace (pnpm)"]
    core["@vacp/core"]
    gw["@vacp/gateway"]
    dom["@vacp/dom"]
    diag["@vacp/diagrams"]
    dbg["@vacp/debug-ui"]
    mosaic["@vacp/mosaic"]
    vega["@vacp/vega-lite"]

    gw --> core
    dom --> core
    diag --> core
    dbg --> core
    dbg --> diag
    mosaic --> core
    mosaic --> dom
    mosaic --> gw
    vega --> core
    vega --> dom
    vega --> gw
  end

  subgraph PY["Python workspace (uv)"]
    mcp["vacp-mcp-server"]
  end

  mcp -. reads/writes JSON .-> core
```

Justification:

- `@vacp/core` is dependency-free and defines the stable contract.
- Adapters (`dom`, `mosaic`) build on `core` but do not redefine protocol semantics.
- Execution (`gateway`) stays reusable: Mosaic is “just another provider” that registers actions and snapshots.

---

## Runtime Architecture (End-to-End)

### High-level system diagram

```mermaid
flowchart LR
  Agent["Agent / LLM Client"] -->|MCP tools| MCP["vacp-mcp-server (FastMCP/FastAPI)"]

  subgraph Browser["Browser - Playwright launched or external CDP"]
    App["VA App - Mosaic/vgplot"]
    Bridge["window.__vacp (capabilities/state/execute)"]
    DOM["Annotated DOM/SVG (data-vacp-*, SVG metadata)"]
    App --> Bridge
    App --> DOM
  end

  MCP -->|Playwright evaluate| Bridge
  MCP -->|DOM scan fallback| DOM
  MCP -->|execute action| Bridge
```

Justification:

- **Bridge-first** avoids brittle DOM scraping, and returns canonical data that is stable across rerenders.
- **DOM fallback** provides compatibility with apps that only annotate the DOM/SVG (or for debugging).

---

## Control & Observation Flows

### 1) Discovery: capabilities snapshot

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as vacp-mcp-server
  participant P as Playwright Page
  participant B as window.__vacp

  A->>S: vacp_capabilities()
  S->>P: evaluate("window.__vacp.getCapabilities()")
  P->>B: getCapabilities()
  B-->>P: VacpCapabilitiesSnapshot (JSON)
  P-->>S: snapshot
  S-->>A: snapshot
```

Fallback path (if `window.__vacp` is missing):

- `vacp-mcp-server` scans `data-vacp-*` and/or parses SVG `<metadata type="application/vacp+json">`.

### 2) State: current selections / params

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as vacp-mcp-server
  participant P as Playwright Page
  participant B as window.__vacp

  A->>S: vacp_state()
  S->>P: evaluate("window.__vacp.getState()")
  P->>B: getState()
  B-->>P: VacpStateSnapshot (JSON)
  P-->>S: snapshot
  S-->>A: snapshot
```

### 3) Control: execute an interaction

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as vacp-mcp-server
  participant P as Playwright Page
  participant B as window.__vacp
  participant R as @vacp/gateway ActionRegistry

  A->>S: vacp_execute("mosaic.set_interval_2d", params)
  S->>P: evaluate("window.__vacp.execute(call)")
  P->>B: execute(call)
  B->>R: ActionRegistry.execute(call)
  R-->>B: VacpActionResult
  B-->>P: result
  P-->>S: result
  S-->>A: result
```

Justification:

- The agent does not click or drag pixels.
- The action handler can enforce parameter validation and app-specific safety.

---

## Mosaic/vgplot Integration: Why it’s “First-Class”

Observable Plot is a renderer. Mosaic/vgplot is a **semantic runtime**:

- It knows:
  - data sources / table refs,
  - how encodings map to fields,
  - which interactors exist and how they modify selections,
  - how linked views synchronize.
- Therefore vgplot is the correct level to generate:
  - stable refs,
  - meaningful action descriptors,
  - state snapshots aligned with the app’s semantics (not DOM quirks).

In this repo, `@vacp/mosaic` provides a minimal implementation that:

- annotates the produced SVG (and `[data-index]` mark groups),
- embeds a canonical VACP graph into SVG metadata,
- installs an in-page bridge (`window.__vacp`) for fast/robust MCP access,
- exposes basic interactor actions for Interval1D/Interval2D.

---

## Surfaces (Python MCP): Why a Surface abstraction?

`vacp-mcp-server` models the target app as a `Surface` with three operations:

- `get_capabilities()`
- `get_state()`
- `execute(call)`

This cleanly supports:

- **bridge-first**: `PlaywrightBridgeSurface`
- **fallback**: `PlaywrightDomSurface`
- future backends: Selenium, remote CDP, native apps, etc.

This keeps the MCP server generic and avoids hardcoding Mosaic logic into Python.

---

## Design Justifications (tradeoffs and rationale)

### Bridge-first is the default

Pros:

- stable IDs and schemas across rerenders
- fast (no full DOM traversal)
- can expose non-DOM state (selections, params, computed summaries)

Cons:

- requires cooperative app integration (installing the bridge)

### DOM/SVG annotations remain important

Pros:

- supports partially-integrated apps
- makes debugging easier (inspect DOM to see VACP tags)
- enables “view source”-like offline artifact capture (SVG metadata)

Cons:

- scanning is slower and less stable than a canonical bridge
- DOM order is not a reliable identity strategy for dynamic apps

### Mosaic-first integration does not reduce reusability

The reusable parts are `@vacp/core` + `@vacp/gateway`:

- any app can create snapshots and register actions
- Mosaic is only one provider that uses those abstractions

---

## How to extend

### Add new actions

- Define a `VacpActionDescriptor` (name, description, parameter schema, targetRef).
- Register handler via `VacpActionRegistry.register(descriptor, handler)`.
- Include the descriptor in the capabilities graph.

### Add new node kinds / summaries

- Add a new node in the graph with a stable `ref`.
- Put its current state under `VacpStateSnapshot.state[ref]`.
- Optionally include fast summaries (`summary[ref]`) to avoid “DataLayer explosion”.

### Add a new integration provider

Create a package like `@vacp/<provider>` that:

- builds snapshots from your app’s runtime model,
- registers actions,
- optionally annotates DOM/SVG for discoverability,
- installs `window.__vacp`.

---

## Tooling / Quality Gates

- TypeScript:
  - `oxlint` for lint (`pnpm -C vacp -r lint`)
  - `prettier` for formatting (`pnpm -C vacp format`)
  - `tsc -b` project references for typechecking/build (`pnpm -C vacp -r typecheck`)
- Python:
  - `ruff` for lint + format (`uv run ruff check ...`, `uv run ruff format ...`)
  - `ty` for typechecking (run it in the project env so imports resolve): `cd packages/server/vacp-mcp-server && uv run --with ty ty check src/vacp_mcp_server`
