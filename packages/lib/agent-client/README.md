# @vacp/agent-client

Client-side VACP transport adapter for AI SDK agents.

## Purpose

`@vacp/agent-client` is the direct, in-page transport implementation that pairs with MCP:

- MCP transport (`vacp-mcp-server`) calls `window.__vacp` via Playwright.
- Client transport (`@vacp/agent-client`) calls `window.__vacp` directly from browser JS.

Both expose the same semantic tool surface:

- `vacp_capabilities(options?)`
- `vacp_state(options?)`
- `vacp_execute(name, params?, call_id?)`

## Main exports

- `createWindowVacpTransport(bridge)`
- `createVacpTools({ transport, onToolEvent? })`
- `createVacpToolLoopAgent({ config, transport, ... })`
- `createVacpDirectChatTransport(...)`
- `createVacpChatRuntime(...)`
- `listVacpLLMModels(config, options?)`
- `loadVacpLLMConfig` / `saveVacpLLMConfig` / `clearVacpLLMConfig`

## Notes

- Provider config supports:
  - `openai-compatible` (`providerName`, `baseURL`, `apiKey`, `model`)
  - `gemini` (`apiKey`, `model`, optional `baseURL`)
- `VacpLLMConfig` also supports `maxOutputTokens` for output-bound control.
- Chat runtime applies balanced context compaction by default (keeps recent full tool traces and compacts older turns for model input).
- `vacp_capabilities(options?)` supports scoped graph reads (`refs/prefixes/kinds/layers/include*`) for token efficiency.
- `vacp_execute` auto-generates `callId` when not provided.
- Runtime bridge mode auto-switches from `inspect` to `live` before mutating executes.
