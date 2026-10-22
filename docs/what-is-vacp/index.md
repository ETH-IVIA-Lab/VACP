# What is VACP?

VACP (Visual Analytics Context Protocol) lets an AI agent work in a visual analysis the way the person using it does. The agent reads the views, selections, parameters, and data that are on screen, and changes them through named operations such as "brush the age axis from 22 to 28". The person watching sees each step on the charts as it happens. The [VACP paper](https://arxiv.org/abs/2603.29322) describes the design and its evaluation.

![An agent reads the state of a visual analysis, discovers the interactions available, and executes named operations that update the charts.](/images/VACP_Teaser.svg)

VACP runs inside the page. A provider describes each analytical source, the runtime composes the providers into one observation, and the page bridge serves that observation to agents and to interfaces built for people.

<ArchitectureDiagram />

## Providers describe sources

A source is a system that owns analytical values: a [Vega-Lite](https://vega.github.io/vega-lite/) chart, a dashboard built with [Mosaic vgplot](https://idl.uw.edu/mosaic/vgplot/), a set of form controls, or a notebook. A provider binds one source to VACP. It does three things:

- It projects the source as a graph of entities, such as views, marks, selections, parameters, widgets, and data handles, and the relationships between them.
- It reports the current value of each entity as state.
- It prepares and executes operations against the source, through the source's own API.

`@ethivia/vacp-vega-lite` and `@ethivia/vacp-vgplot` provide this for Vega-Lite and Mosaic vgplot. Any other application defines its operations with `@ethivia/vacp-sdk` and its provider with `createVacpProvider` from `@ethivia/vacp-runtime`. Each entity has a stable ref such as `vacp://analysis/overview/scatter/param/brush`, so an agent can refer to it across reads and rerenders.

## The runtime composes one observation

The runtime reads every provider and publishes one observation: the graph, the state, which source owns each entity and operation, and whether each output is up to date with its inputs. In the browser, the runtime installs a bridge at `window.__vacp`. Open any [example](https://examples.vacp.dev/) and run this in the console:

```js
const observation = await window.__vacp.observe();
observation.graph.nodes.length; // entities across every source on the page
observation.graph.actions.map((action) => action.name); // operations available now
```

The graph lists only the operations that can run in the current state. A chart that has no data yet offers no brushing operation until a dataset loads. The [core concepts](../concepts/) page describes each part of an observation.

## Agents and people share one runtime

An agent changes the analysis by executing an operation by name, with parameters its schema accepts and a sentence for the person watching:

```js
await window.__vacp.execute(
  { name: 'cohort.set_sex', params: { sex: 'female' } },
  { narration: 'Keeping only female athletes.' },
);
```

The runtime validates the parameters, resolves the native target, and then applies the change through the provider. The same runtime observes changes a person makes with the mouse. Both kinds of change land in one provenance journal, and each record names its actor. Three things follow from that journal:

- Presence shows the agent's cursor travelling to each target with its sentence.
- Replay steps back through the agent's checkpoints and restores the charts to each one.
- Inspection surfaces show the graph and its history for debugging and teaching.

Agents reach the runtime through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), the protocol agent clients such as Claude Code use to call external tools. In-page agents use [AI SDK](https://ai-sdk.dev) tools, and browser agents use [WebMCP](https://webmachinelearning.github.io/webmcp/).

## Packages

| Package                                                   | Role                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@ethivia/vacp-protocol`](../api/protocol)               | Records and contracts shared by every package and the Python server                 |
| [`@ethivia/vacp-runtime`](../api/runtime)                 | Composes providers, executes operations, and records provenance                     |
| [`@ethivia/vacp-browser`](../api/browser)                 | Installs a runtime in a page and publishes `window.__vacp`                          |
| [`@ethivia/vacp-sdk`](../api/sdk)                         | Defines operations with [Zod](https://zod.dev) schemas for a custom provider        |
| [`@ethivia/vacp-vega-lite`](../api/vega-lite)             | Provider for Vega-Lite views                                                        |
| [`@ethivia/vacp-vgplot`](../api/vgplot)                   | Provider for Mosaic vgplot plots, inputs, legends, and tables                       |
| [`@ethivia/vacp-duckdb`](../api/data-duckdb)              | SQL access to data handles through [DuckDB](https://duckdb.org)                     |
| [`@ethivia/vacp-bridge`](../api/transport-bridge)         | The five agent tools over a page bridge                                             |
| [`@ethivia/vacp-ai-sdk`](../api/agent-ai-sdk)             | An in-page agent built on the AI SDK                                                |
| [`@ethivia/vacp-webmcp`](../api/webmcp)                   | Registers operations as browser-native WebMCP tools                                 |
| [`@ethivia/vacp-presence`](../api/presence-core)          | Headless agent activity, targets, and pacing                                        |
| [`@ethivia/vacp-presence-react`](../api/presence-browser) | Cursor and narration overlay for the browser                                        |
| [`@ethivia/vacp-provenance`](../api/provenance)           | Checkpoints, value attribution, and replay over the provenance journal              |
| [`@ethivia/vacp-inspector`](../api/inspector)             | Sessions and graph lookups for custom inspection surfaces                           |
| [`@ethivia/vacp-analytics`](../api/analytics)             | Forwards runtime events to a telemetry provider                                     |
| [`@ethivia/vacp-posthog`](../api/analytics)               | The telemetry provider for [PostHog](https://posthog.com), a product analytics tool |
| [`vacp` (Python)](../api/python)                          | MCP server for external agents, and Python providers                                |

Next, [get started](../get-started/) with the examples and connect an agent.
