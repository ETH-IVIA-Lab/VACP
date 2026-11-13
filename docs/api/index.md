# API reference

Each page documents one package entry or one shared contract: every exported name with its signature, behavior, options and defaults, return value, and errors. [Install](../install/) lists the packages and their peer dependencies, and [Concepts](../concepts/) defines the terms these pages use.

## @ethivia/vacp-sdk

- [Actions and providers](./actions): `createVacpActions`, `createVacpProvider`, `VacpActionRegistry`, the standard actions, and subscription helpers.
- [Runtime and page bridge](./runtime): `createVacpRuntime`, `installVacpRuntime`, the DOM snapshot, restoration, and actors.
- [Provenance and replay](./provenance): `createProvenanceReplay`, checkpoints, and value attribution.
- [Protocol types](./protocol): nodes, edges, actions, observations, state updates, freshness, availability, executions, and provenance records.
- [`/data`](./data): data handles, and registration and DuckDB handlers for the `vacp.data_sql` and `vacp.data_schema` actions.
- [`/presence`](./presence): the presence engine, targets, and pacing.
- [`/agent`](./agent): the page bridge reader, the agent tools over it, WebMCP registration, and the tool contract.
- [`/inspector`](./inspector): inspection sessions, graph indexes, and clients.
- [Agent tools](./agent-tools): the five agent tools, their inputs, results, and bounds.

## Integrations

- [`@ethivia/vacp-vega`](./vega): the Vega-Lite provider and presentation.
- [`@ethivia/vacp-vgplot`](./vgplot): the Mosaic vgplot provider and presentation.
- [`@ethivia/vacp-duckdb`](./duckdb): a DuckDB-Wasm client.
- [`@ethivia/vacp-ai`](./ai): AI SDK tools, an agent, and a chat runtime.
- [`@ethivia/vacp-overlay`](./overlay): the browser presence overlay and Markdown bubbles.
- [`@ethivia/vacp-posthog`](./posthog): provenance events in PostHog.
- [`vacp` (Python)](./python): the MCP server, Python providers, and the inspection endpoint.
