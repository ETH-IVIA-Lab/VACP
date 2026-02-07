# VACP Architecture

VACP makes interactive visualization apps **agent-ready** without pixel automation.

It does this by standardizing a tiny in-page API (`window.__vacp`) that supports:

- **Capabilities**: “what exists and what can I do?”
- **State**: “what is currently selected / configured?”
- **Actions**: “perform a semantic interaction with parameters”

This document describes the system design and the VACP protocol implemented in this repository.

---

## System overview

```mermaid
flowchart LR
  Agent["Agent / LLM client"] -->|MCP tools| MCP["vacp-mcp-server (Playwright + MCP)"]

  subgraph Browser["Browser (Playwright-launched or external Chrome via CDP)"]
    App["Visualization app (Mosaic / Vega-Lite / D3 / …)"]
    Bridge["window.__vacp (capabilities / state / execute)"]
    Runtime["Runtime (history, time travel, playbooks)"]
    Debug["Optional debug overlay"]

    App --> Bridge
    Bridge --> Runtime
    Debug --> Bridge
  end

  MCP -->|evaluate| Bridge
```

Key idea: **the protocol lives inside the app**. MCP is only one transport.

---

## Bidirectional control

The goal is “mixed initiative”: human and agent can interleave work seamlessly.

- A **human** brushes/clicks/toggles in the UI.
- The app updates its semantic state (selection, param, etc.).
- The VACP bridge reports that state via `getState()`.
- An **agent** can apply the same semantic change by calling a named action (no pixels).
- Both paths are recorded into one shared runtime history for debugging/time travel.

---

## Protocol

This repo implements VACP as a small set of JSON messages plus an in-page RPC interface.

### Terms

- **Ref**: a stable identifier for a semantic entity (string; often `vacp://…`).
- **Graph**: a semantic model of the UI (nodes + edges + actions).
- **Capabilities snapshot**: a timestamped graph.
- **State snapshot**: timestamped values keyed by `ref`.
- **Action**: a named semantic operation with a JSON parameter schema.

### Conformance

An implementation is “VACP-conformant” if it:

- **MUST** provide `getCapabilities()`, `getState()`, and `execute(call)` via a stable bridge object (typically `window.__vacp`).
- **MUST** use stable `ref` strings as identifiers (not DOM position).
- **MUST** return versioned snapshots with ISO timestamps.
- **SHOULD** ensure actions are safe and validated (reject invalid params; do not rely on pixel events).
- **MAY** additionally expose runtime/history APIs (`getRuntime`, `undo/redo`, playbooks, overrides) for debugging and research workflows.

### Data model

The canonical semantic model is a directed labeled graph:

- `G = (V, E)` where `V` are nodes and `E` are edges.
- Each node has a unique `ref` and a `kind` (e.g. `View`, `Visualization`, `Param`, `Selection`, `InteractionTarget`).
- Edges describe relationships (e.g. `contains`, `controls`, `depends_on`).

Actions are attached to the graph as descriptors:

```ts
type VacpActionDescriptor = {
  name: string; // stable action id, e.g. "mosaic.set_interval_1d"
  description?: string; // human-readable
  parameters: object; // JSON-schema-like shape
  targetRef?: string; // optional: node this action applies to
};
```

### Snapshots

Capabilities snapshot (what exists):

```ts
type VacpCapabilitiesSnapshot = {
  version: string;
  createdAt: string; // ISO timestamp
  graph: { version: string; nodes: VacpNode[]; edges: VacpEdge[]; actions: VacpActionDescriptor[] };
};
```

State snapshot (what is currently true):

```ts
type VacpStateSnapshot = {
  version: string;
  createdAt: string; // ISO timestamp
  state: Record<string /* ref */, unknown /* typed by kind */>;
  summary?: Record<string /* ref */, unknown>;
};
```

Design note: **state is keyed by `ref`**, not by DOM position. This is what makes the protocol stable across rerenders.

### Action calls and results

```ts
type VacpActionCall = { callId: string; name: string; params?: unknown };
type VacpActionResult = { callId: string; ok: boolean; result?: unknown; error?: { message: string } };
```

### In-page bridge

Providers install a bridge (usually) at `window.__vacp`:

```ts
interface VacpWindowBridge {
  getCapabilities(): Promise<VacpCapabilitiesSnapshot>;
  getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  getState(): Promise<VacpStateSnapshot>;
  execute(call: VacpActionCall): Promise<VacpActionResult>;
}
```

This repo's runtime bridge may also provide optional debugging endpoints:

- `getRuntime()` (history, cursor, “inspect” vs “live”)
- `dispatch(call, options)` (records source/message)
- `getPlaybooks()` (scripted stepper)
- `undo/redo`, `setMode`, `setStateOverride`, `setGraphOverride`, `refresh`, `subscribe`

### Invariants and design intent

These invariants are what make the protocol useful for mixed-initiative systems:

- **Stability**: the same `ref` keeps meaning across rerenders and time.
- **Semantic actions**: actions describe intent (e.g. “set interval selection”), not “click this DOM node”.
- **Bidirectionality**: human input and agent calls produce compatible state snapshots.
- **Transport-agnostic**: MCP, WebSocket, or any other wire can carry the same messages.

### State tokens and token-efficient state retrieval

#### State token

A **state token** is a deterministic content identifier for a scoped state snapshot:

- shape: `st_<hash(canonical_json({ state, summary? }))>`
- equal token => equal scoped semantic state content
- different token => at least one scoped value or summary changed

The token is computed after applying request scope (`refs`, `includeSummary`), so it precisely identifies the payload the caller asked for.

#### Problem

For non-trivial apps, repeatedly shipping the entire state map on every agent step is wasteful:

- high token cost for LLM calls,
- repeated parsing of unchanged structure,
- unnecessary latency.

#### API shape

`getState()` now has two modes:

- no argument: return full `VacpStateSnapshot` (backward-compatible baseline read),
- with request: return `VacpStateUpdate` envelope.

Request options:

- `mode`: `auto | full | delta`
- `since`: prior state token
- `refs`: optional ref subset (scoping)
- `includeSummary`: include/exclude summary map

Response envelope:

- `mode: "full"`: `{ token, snapshot, scope? }`
- `mode: "delta"`: `{ token, baseToken, delta, scope? }`

#### How delta computation works

Runtime algorithm (`packages/lib/gateway/src/runtime/create-runtime-bridge.ts` + `state-update.ts`):

1. Normalize request (default `mode="auto"`; optional `since/refs/includeSummary`).
2. Scope current state to requested refs/summary policy.
3. Compute deterministic token `st_<hash(canonical_json)>`.
4. If `since` token resolves to a cached baseline and mode is not forced `full`, compute delta:
   - `changed`: refs whose values differ,
   - `removed`: refs missing from current,
   - `summaryChanged/summaryRemoved` similarly for summaries.
5. If baseline is missing (stale/unknown `since`), fall back to `mode: "full"` automatically.
6. Cache the scoped full snapshot under its token (bounded insertion-ordered map, size 64).

This guarantees correctness without requiring long-lived server session state: token cache miss is safe and explicit (full fallback).

#### Why this is useful

- Caller can cheaply poll with `mode="delta"` and only process change sets.
- `refs` scoping prevents unrelated state from entering context.
- `includeSummary=false` lets callers skip secondary payload when not needed.
- `token/baseToken` makes state transitions auditable and composable.

### Discovery (optional DOM snapshot, incremental)

Some agents/tools can only “see” the DOM. For that case, `@vacp/gateway` injects a JSON semantic layer rooted at:

- `id="__vacp_snapshot"` (compact manifest, `format: "vacp.dom_snapshot"`).

The injected payloads are intentionally unversioned (greenfield contract) and split for progressive reads:

The manifest points to additional JSON scripts:

- graph script (`manifest.graph.scriptId`) with compact graph/action structure,
- state index script (`manifest.state.indexScriptId`) with `{ token, baseToken?, changedRefs, removedRefs, catalog }`,
- state catalog script (`manifest.state.catalogScriptId`) with stable ref metadata (`ref`, `scriptId`, kind/layer/title),
- per-ref scripts: `script[data-vacp="snapshot-ref"][data-vacp-ref="vacp://..."]` containing `{ ref, value, summary? }`.

DOM update strategy (`packages/lib/gateway/src/dom-snapshot.ts`):

- graph script rewrites only when `graphToken` changes,
- per-ref scripts rewrite only for changed refs (fingerprint diff),
- removed refs delete their script nodes,
- catalog rewrites only when ref membership/metadata changes (`catalogToken`),
- index + manifest update each cycle to advertise current tokens and change counts.

This lets DOM-only agents do incremental consumption:

1. read manifest,
2. read state index,
3. if `catalog.changed`, refresh catalog, else reuse prior map,
4. fetch only scripts listed in `changedRefs`.

This is enabled by default and can be disabled via:

- env: `VACP_DOM_SNAPSHOT=0`
- URL: `?vacp-dom-snapshot=0`

### Debug overlay (optional)

The in-page overlay (`@vacp/debug-ui`) is intentionally opt-in:

- env: `VACP_DEBUG_UI=1`
- URL: `?vacp-debug=1`
- localStorage: `vacp:debug=1`

### MCP mapping

The Python `vacp-mcp-server` maps the bridge to MCP tools:

- `vacp_capabilities()` → `window.__vacp.getCapabilities()`
- `vacp_state(options?)` → `window.__vacp.getState(options?)`
- `vacp_execute(name, params?, call_id?)` → `window.__vacp.execute({callId, name, params})`

`vacp_state(options)` is validated with a strict typed schema (`TypedDict` + Pydantic `TypeAdapter`) before forwarding to the bridge.

## Control and observation flows

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as vacp-mcp-server
  participant P as Playwright Page
  participant B as window.__vacp

  A->>S: vacp_capabilities()
  S->>P: evaluate(getCapabilities)
  P->>B: getCapabilities()
  B-->>P: capabilities JSON
  P-->>S: capabilities JSON
  S-->>A: capabilities JSON
```

```mermaid
sequenceDiagram
  participant A as Agent
  participant S as vacp-mcp-server
  participant P as Playwright Page
  participant B as window.__vacp

  A->>S: vacp_execute(name, params)
  S->>P: evaluate(execute)
  P->>B: execute(call)
  B-->>P: action result
  P-->>S: action result
  S-->>A: action result
```

---

## Implementation map

TypeScript (pnpm):

- `@vacp/core`: protocol types (the JSON contract).
- `@vacp/gateway`: runtime bridge + action registry + history/time travel.
- `@vacp/kit`: helpers for “bring-your-own-provider” integrations (see `packages/examples/cars-parallel-coords` and `packages/examples/react-dashboard`).
- `@vacp/diagrams`: Mermaid source generation for graphs.
- `@vacp/debug-ui`: in-page overlay that inspects `window.__vacp`.
- `@vacp/vgplot`: provider for Mosaic/vgplot.
- `@vacp/vega-lite`: provider for Vega-Lite/Vega views.

Python (uv):

- `vacp-mcp-server`: MCP transport that uses Playwright to call the in-page bridge (`window.__vacp`).

---

## Quality gates

From the repo root:

- Format: `pnpm format`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Web smoke tests (runs all examples): `pnpm test:examples`
- MCP server tests: `pnpm test:server`
