# API reference

Each package page lists its entry points, signatures, options with defaults, return values, errors, and lifecycle. Protocol records and Agent tools document the contracts every package and transport share. The [core concepts](../concepts/) page defines the records these APIs exchange.

## Contracts

- [Protocol records](./protocol): nodes, edges, operations, observations, state updates, freshness, availability, executions, and provenance records from `@ethivia/vacp-protocol`.
- [Agent tools](./agent-tools): the five shared agent tools, their inputs, results, and bounds.

## Runtime

- [`@ethivia/vacp-runtime`](./runtime): `createVacpRuntime`, `createVacpProvider`, standard operations, restoration, and execution activity.
- [`@ethivia/vacp-browser`](./browser): `installVacpRuntime`, `getVacpBridge`, and the DOM snapshot format.
- [`@ethivia/vacp-sdk`](./sdk): `createVacpActions` and `createVacpRefBuilder` for custom providers.

## Providers

- [`@ethivia/vacp-vega-lite`](./vega-lite): `createVegaLiteProvider` and its operations.
- [`@ethivia/vacp-vgplot`](./vgplot): `createVgplotProvider` and its operations.
- [`@ethivia/vacp-duckdb`](./data-duckdb): DuckDB clients and the `vacp.data_sql` and `vacp.data_schema` handlers.

## Agents

- [`@ethivia/vacp-bridge`](./transport-bridge): `createVacpTransport` over a page bridge.
- [`@ethivia/vacp-ai-sdk`](./agent-ai-sdk): AI SDK tools, an agent, and a chat runtime.
- [`@ethivia/vacp-webmcp`](./webmcp): `installVacpWebMcp` and the tools it registers.
- [`vacp` (Python)](./python): the MCP server CLI, Python providers, and the inspection endpoint.

## Presence and history

- [`@ethivia/vacp-presence`](./presence-core): headless presence, targets, and pacing.
- [`@ethivia/vacp-presence-react`](./presence-browser): the browser overlay and its appearance options.
- [`@ethivia/vacp-provenance`](./provenance): checkpoints and replay.
- [`@ethivia/vacp-inspector`](./inspector): inspection sessions, graph indexes, and clients.
- [`@ethivia/vacp-analytics`](./analytics): runtime telemetry, and `createPosthogProvider` from `@ethivia/vacp-posthog`.
