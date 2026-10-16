# API reference

Each package page lists its entry points, signatures, options with defaults, return values, errors, and lifecycle. Protocol records and Agent tools document the contracts every package and transport share. The [core concepts](../concepts/) page defines the records these APIs exchange.

## Contracts

- [Protocol records](./protocol): nodes, edges, operations, observations, state updates, freshness, availability, executions, and provenance records from `@vacp/protocol`.
- [Agent tools](./agent-tools): the five tools every agent transport offers, their inputs, results, and bounds.

## Runtime

- [`@vacp/runtime`](./runtime): `createVacpRuntime`, `createVacpProvider`, standard operations, restoration, and execution activity.
- [`@vacp/runtime-browser`](./browser): `installVacpRuntime`, `getVacpBridge`, and the DOM snapshot format.
- [`@vacp/sdk`](./sdk): `createVacpActions` and `createVacpRefBuilder` for custom providers.

## Providers

- [`@vacp/adapter-vega-lite`](./vega-lite): `createVegaLiteProvider` and its operations.
- [`@vacp/adapter-vgplot`](./vgplot): `createVgplotProvider` and its operations.
- [`@vacp/data-duckdb`](./data-duckdb): DuckDB clients and the `vacp.data_sql` and `vacp.data_schema` handlers.

## Agents

- [`@vacp/transport-bridge`](./transport-bridge): `createVacpTransport` over a page bridge.
- [`@vacp/agent-ai-sdk`](./agent-ai-sdk): AI SDK tools, an agent, and a chat runtime.
- [`@vacp/transport-webmcp`](./webmcp): `installVacpWebMcp` and the tools it registers.
- [`vacp` (Python)](./python): the MCP server CLI, Python providers, and the inspection endpoint.

## Presence and history

- [`@vacp/presence-core`](./presence-core): headless presence, targets, and pacing.
- [`@vacp/presence-browser`](./presence-browser): the browser overlay and its appearance options.
- [`@vacp/provenance-core`](./provenance): checkpoints and replay.
- [`@vacp/inspector-core`](./inspector): inspection sessions, graph indexes, and clients.
- [`@vacp/analytics`](./analytics): runtime telemetry, and `createPosthogProvider` from `@vacp/analytics-posthog`.
