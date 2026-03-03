# @vacp/core

## Purpose

Protocol types for VACP.

This package is intentionally dependency-free. It defines the stable JSON shapes that apps produce and tools/transports consume.

## When to use

- You are implementing a VACP provider or integration and want the canonical types.
- You are building tooling around VACP (debug UI, transports, tests).

## Conceptual model

- **Capabilities**: a semantic graph (nodes/edges) plus action descriptors.
- **State**: current values keyed by stable semantic refs.
- **Actions**: named operations with validated parameters.

The in-page bridge is typically installed as `window.__vacp`.

## Minimal usage

`@vacp/core` does not install a bridge by itself. Most apps use `@vacp/gateway` (directly or through a provider) to install the runtime bridge.

## Related docs

- [What is VACP?](../../../../docs/what-is-vacp/index.md)
- [Core runtime](../../../../docs/core-runtime/index.md)
- [Tool Contract](../../../../docs/reference/tool-contract.md)
- [Glossary](../../../../docs/reference/glossary.md)
