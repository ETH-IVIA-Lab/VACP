# @vacp/protocol

## Purpose

Protocol types for VACP.

It defines the stable JSON shapes that apps produce and tools and transports consume. The root entry has no dependencies. `@vacp/protocol/validation` parses observations, action results, and capabilities and state requests with Zod.

## When to use

- You are implementing a VACP provider or integration and want the canonical types.
- You are building tooling around VACP (inspector, transports, tests).

## Conceptual model

- **Capabilities**: a semantic graph (nodes/edges) plus action descriptors.
- **State**: current values keyed by stable semantic refs.
- **Actions**: named operations with validated parameters.

`VacpWindowBridge` holds the model-facing reads and execution. `VacpPageBridge` adds inspection, refresh, provenance, agent activity, and the execution stream, and is the runtime a page publishes, typically as `window.__vacp`.

## Minimal usage

`@vacp/protocol` does not install a bridge by itself. Most apps use `@vacp/runtime` (directly or through a provider) to install the runtime bridge.

## Related docs

- [What is VACP?](../../docs/what-is-vacp/index.md)
- [Runtime reference](../../docs/api/runtime.md)
- [Agent tools](../../docs/api/agent-tools.md)
- [Core concepts](../../docs/concepts/index.md)
