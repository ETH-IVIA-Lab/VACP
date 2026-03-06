# @vacp/debug-ui

## Purpose

Opt-in in-page debug overlay for VACP.

The overlay is provider-agnostic: it talks to the same in-page bridge (`window.__vacp`) that agents use.

## When to use

- You are integrating VACP and want to validate your graph/state/actions.
- You want a fast way to inspect and replay semantic transitions.

## Conceptual model

The overlay is a consumer of the VACP contract:

- it reads capabilities and state,
- it dispatches semantic actions,
- it can inspect optional runtime/history endpoints when available.

The Chat tab records the effective tool inputs that were executed. If a request is normalized before dispatch, the trace and Markdown export preserve both the effective input and the original requested input.

## Minimal usage

Enable at runtime:

- URL: `?vacp-debug=1`
- Env: `VACP_DEBUG_UI=1`

In this repo, examples typically lazy-load the overlay when enabled.

## Related docs

- [Debug overlay](../../../../docs/debug/index.md)
- [Configuration](../../../../docs/reference/configuration.md)
- [Get started](../../../../docs/get-started/index.md)
