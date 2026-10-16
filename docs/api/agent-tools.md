# Agent tools

Every agent transport offers five tools with the same names, input fields, and descriptions, defined once in `@vacp/protocol` as `vacpAgentTools`. The AI SDK tools and the Python MCP server use these names. [WebMCP](./webmcp) registers the three reads and the progress tool as `vacp.observe`, `vacp.capabilities`, `vacp.state`, and `vacp.progress`, and one tool per operation in place of `vacp_execute`.

```text
vacp_observe()
vacp_capabilities({ refs?, prefixes?, kinds?, layers?, includeActions?, includeEdges?, includeNodeData? })
vacp_state({ since?, refs?, includeSummary? })
vacp_execute({ name, params?, narration, call_id? })
vacp_progress({ message, done? })
```

Each transport gives the model `vacpAgentToolGuidance` with the tools: read `vacp_observe` once per request, read changes with `vacp_state` and `since`, scope reads once targets are known, and narrate every step.

## vacp_observe

Returns one observation: the graph with the operations available now, state, summaries, revision, and freshness. Read it at the start of a request, and again when the available operations may have changed, such as after a dataset loads, or when `vacp_execute` reports an unknown or unavailable operation.

## vacp_capabilities

Returns the graph, scoped by `refs`, `prefixes`, `kinds`, and `layers`. A scoped read keeps the transitive prerequisites of matching nodes as context. An unscoped read, or a bare `vacp://` in `refs` or `prefixes`, returns everything and leaves out node `data` unless `includeNodeData` is `true`.

## vacp_state

Returns state keyed by ref. Without `since`, it returns the full state and a `token`. With `since` set to the token of an earlier read, it returns only what changed:

```json
{
  "mode": "delta",
  "token": "t2",
  "baseToken": "t1",
  "delta": { "changed": { "vacp://example/threshold": { "value": 42 } }, "removed": [] }
}
```

A token the runtime no longer knows returns a full read. `refs` limits the read. A container ref such as a view includes the state of the entities inside it.

## vacp_execute

Runs one operation by its `name` from the graph. `params` is any JSON value the operation's schema accepts. Leaving `params` out keeps the operation's defaults, and `null` passes an explicit null. `narration` is the step's sentence for the person watching, at most 280 characters. The result is the operation's envelope, `{ callId, ok, result }` or `{ callId, ok: false, error }`.

## vacp_progress

Shows one plain sentence to the person: once before the first operation, and once with `done: true` when the request is finished. The sentence opens the agent's turn, or joins the turn the host opened.

## Result bounds

Every result reaches the model as JSON cut to the same bounds, in every transport:

| Value  | Kept              | Marker of what was cut                 |
| ------ | ----------------- | -------------------------------------- |
| String | 12,000 characters | `... [34 more characters]` at the end  |
| Array  | 500 items         | A final `"[5 more items]"` item        |
| Object | 160 keys          | A `"__truncated": "2 more keys"` entry |
| Depth  | 32 levels         | `[Array(n)]` or `[Object]`             |

Each limit counts its marker. A result already within the bounds passes through unchanged. `vacpToolResult` applies the bounds in TypeScript and `tool_result` in Python, checked against shared fixtures. A `vacp.data_sql` JSON result returns at most 500 rows, and its `truncated` field says whether the query had more.

Graph reads that reach a model leave out source ownership. `bridge.observe()` and `runtime.inspect()` keep it for routing and inspection.

## Data handles

A `DataHandle` node stands for a table an agent queries through `vacp.data_sql` and `vacp.data_schema`. [Data handles](./protocol#data-handles) lists the fields of its node and state.

## Example

A model reads a data handle's operations, then lists its columns. The calls, written as functions:

```ts
const handleRef = 'vacp://vacp-examples/data/main';
const capabilities = await vacp_capabilities({ refs: [handleRef] });
const action = capabilities.graph.actions.find((action) => action.operation.contract === 'vacp.data_schema');
if (!action) throw new Error('Schema inspection is unavailable for this data handle');
await vacp_execute({
  name: action.name,
  params: { handleRef, detail: 'columns' },
  narration: 'Listing the columns of the cars table.',
  call_id: 'call-1',
});
```

```json
{
  "callId": "call-1",
  "ok": true,
  "result": {
    "handleRef": "vacp://vacp-examples/data/main",
    "detail": "columns",
    "vacp_handle": {
      "table": "cars",
      "rowCount": 406,
      "columns": [
        { "name": "mpg", "type": "DOUBLE" },
        { "name": "weight", "type": "DOUBLE" }
      ]
    }
  }
}
```
