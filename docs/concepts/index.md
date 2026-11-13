# Core concepts

VACP describes a visual analysis as data an agent can read and act on. This page defines each term once, using one small analysis: a histogram of exam scores with a brush selection that filters a table of students.

## Provider

A **source** is a system that owns analytical values, such as a Vega-Lite chart, a Mosaic vgplot dashboard, or a set of controls in your app. A **provider** wraps one source. It reports the source's part of the graph and its current state, and it applies actions through the source's own API. `@ethivia/vacp-vega` and `@ethivia/vacp-vgplot` create providers for their libraries. `createVacpProvider` creates one for anything else, as [Custom provider](../custom-provider/) shows.

## Runtime

The **runtime** composes every provider on the page. It tracks which source owns each node and action, executes actions, and records [provenance](#provenance). `installVacpRuntime` creates the runtime for a page. [Compose sources](../composition/) puts several providers in one runtime.

## Graph, node, and ref

The **graph** lists what exists in the analysis. Here is the graph for the scores histogram:

```json
{
  "nodes": [
    { "ref": "vacp://scores/histogram", "kind": "View", "layer": "ViewLayer", "title": "Scores" },
    {
      "ref": "vacp://scores/histogram/brush",
      "kind": "Selection",
      "layer": "InteractionFeedbackLayer",
      "title": "Score brush"
    },
    { "ref": "vacp://scores/students", "kind": "DataHandle", "layer": "DataLayer", "title": "Students" }
  ],
  "edges": [
    { "from": "vacp://scores/histogram", "to": "vacp://scores/histogram/brush", "kind": "contains" },
    { "from": "vacp://scores/histogram/brush", "to": "vacp://scores/students", "kind": "controls" }
  ],
  "actions": [
    { "name": "scores.brush", "operation": { "kind": "mutation", "affects": ["vacp://scores/histogram/brush"] } }
  ]
}
```

A **node** is one analytical entity: a view, a mark, a selection, a parameter, a widget, or a data handle. Its `kind` names what it is, and its `layer` groups it by role. Edges relate nodes. `contains` places the brush in the histogram, and `controls` says the brush filters the students table.

A **ref** is a node's stable `vacp://` identifier. The provider derives it from its own model, such as a view ID or a parameter name, so the ref stays the same across rerenders and reads. Agents read refs from the graph and pass them back unchanged.

## State

**State** holds the current value of each node, keyed by ref. A selection's state is in data units:

```json
{ "vacp://scores/histogram/brush": { "kind": "Interval1D", "selectionValue": [60, 80] } }
```

## Action

An **action** is a named change or query an agent can execute, listed in `graph.actions`. In code, `createVacpActions().operation(kind, name, description)` defines one, and each entry's `operation` field holds its kind, contract, and affected refs. It declares its parameters as JSON Schema, its kind (`mutation`, `creation`, `evaluation`, or `query`), and the refs it affects. The runtime executes a call in two steps. It validates the parameters first, and only a valid call reaches the source:

```js
await window.__vacp.execute({ name: 'scores.brush', params: { range: [60, 80] } });
```

A **contract** is a name for what an action does that several sources can share, such as `vacp.data_sql` for a SQL query over a data handle. An action states its contract in `operation.contract`. Action names can carry a source prefix, so an agent finds an action by its contract and then calls its `name`.

The graph lists only the actions that can run in the current state. [Declare availability](../availability/) explains how a provider marks an action as unavailable. [Protocol types](../api/protocol) gives every field of an action and lists the [standard contracts](../api/protocol#standard-contracts).

## Observation

An **observation** is one read of the whole page: the graph, the state, and a `revision` that changes when either changes. It can also report freshness, which says whether a chart has caught up with its inputs. Read one with `await window.__vacp.observe()`. [Get started](../get-started/#read-the-page-as-an-agent-does) shows a complete observation.

## Page bridge

The **page bridge** is the runtime published at `window.__vacp`. It offers the reads and execution an agent needs, plus provenance and activity for interfaces built for people. Agents reach it in three ways:

- External clients such as Claude Code, Codex, and Cursor use the MCP server in the `vacp` Python package, which drives the page in Chromium. [MCP](https://modelcontextprotocol.io) is the protocol these clients use to call tools.
- Agents in the page use the tools from `@ethivia/vacp-ai`, built on the [AI SDK](https://ai-sdk.dev), Vercel's TypeScript library for model calls.
- Browser agents use [WebMCP](../agents/webmcp), a proposed browser API through which a page registers each action as a tool.

[Connect an agent](../agents/) compares them. [Runtime and page bridge](../api/runtime) lists every method.

## Data handle

A **data handle** is a `DataHandle` node for a table your app already holds. The graph carries the handle, and the rows stay in their database. An agent queries it with SQL through the `vacp.data_sql` action, which reads two relations. `vacp_handle` holds the rows the view shows under the current selections, and `vacp_all` holds every row:

```sql
SELECT grade, count(*) AS students FROM vacp_handle GROUP BY grade
```

`@ethivia/vacp-sdk/data` creates handles and their SQL actions over any [DuckDB](https://duckdb.org) client. [Data](../api/data) documents it.

## Presence

**Presence** shows the person what the agent is doing. A cursor travels to each step's target, and a bubble beside it shows the sentence the agent sent with the step, its narration. `@ethivia/vacp-overlay` draws the cursor and bubble. A **presentation** tells presence where a provider's refs appear on screen. `createVegaLitePresentation` and `createVgplotPresentation` create one for their libraries. [Agent presence](../presence/) sets it up.

## Provenance

**Provenance** is the list of records the runtime keeps for every change. Each record names its actor: the `agent`, the `human` using the page, or the `system`. Records cover executed actions, observed changes, and the boundaries of turns and sessions. A turn groups the steps of one agent request. From these records, VACP derives checkpoints and replays the analysis to each one. [Provenance and replay](../provenance/) covers the records and replay.
