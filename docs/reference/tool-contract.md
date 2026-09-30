# Tool contract

A model reaches a page through five tools. `@vacp/agent-ai-sdk` gives them to an agent in the page's process, and the Python MCP server gives them to an MCP client. Both offer the same names, input fields, descriptions, and guidance, which `@vacp/protocol` defines as `vacpAgentTools` and `vacpAgentToolGuidance`.

```text
vacp_observe()
vacp_capabilities({ refs?, prefixes?, kinds?, layers?, includeActions?, includeEdges?, includeNodeData? })
vacp_state({ mode?, since?, refs?, includeSummary? })
vacp_execute({ name, params?, narration, call_id? })
vacp_progress({ message, done? })
```

Graph reads leave out source ownership, which the runtime uses to route execution. `bridge.observe()` and `runtime.inspect()` keep it.

Every read and execution result reaches the model as JSON cut to the same bounds, in these two transports and in WebMCP's tools. A string keeps 12,000 characters, an array 500 items, and an object 160 keys, each counting the marker that says what was cut: `... [34 more characters]` at the end of a string, a `"[5 more items]"` item at the end of an array, or a `"__truncated": "2 more keys"` entry. An array or object nested more than 32 levels deep reads as `[Array(n)]` or `[Object]`. A result that is already within the bounds passes through unchanged. `vacpToolResult` in `@vacp/protocol` applies the bounds in `createVacpTransport` and WebMCP, and `tool_result` applies them in the Python server. A `vacp.data_sql` JSON result returns at most 500 rows, and its `truncated` field says whether the query had more.

## vacp_observe

Returns one observation with the graph, available actions, state, revision, summaries, and output freshness. Use it when these values must describe the same read.

Read it once at the start of a request. An action's result and `vacp_state` report what the action changed. Observe again when the available actions may have changed, such as after a dataset loads, or when `vacp_execute` reports an unknown or unavailable action.

## vacp_capabilities

Returns a capabilities snapshot: source descriptions, a semantic graph, and action descriptors for the current interface.

Scoped capability reads retain the transitive prerequisites of matching nodes and actions as context, even when those prerequisites fall outside the requested refs, kinds, or layers. Context nodes do not pull in additional actions.

Omit the scope fields for a broad read. A bare `vacp://` in `refs` or `prefixes` also reads everything. An unscoped read leaves out node `data` unless `includeNodeData` is `true`.

## vacp_state

Returns state keyed by stable refs. Without input it returns the full snapshot. With `mode: "delta"` and the `since` token of an earlier read, it returns only what changed. A `mode: "full"` read resynchronizes when the lineage is unclear.

When `refs` includes a container ref such as a _View_ or _Visualization_, the scoped result includes descendant state entries under that container. This lets callers read the active _Widget_, _Selection_, and _DataHandle_ state for a view without enumerating every child ref first.

## vacp_execute

Executes a discovered action by its unique `name` with validated parameters. `operation.contract` identifies shared semantics independently of that routing name. Action descriptors identify the operation kind, input refs, affected refs, dynamic ref parameters, and produced results. The response is `{ callId, ok, result, error }`.

`narration` is the step's own sentence for the person watching, at most 280 characters. `params` may be any JSON value accepted by the action's schema. Omitting it preserves action defaults. Passing `null` supplies an explicit null value, and the Python MCP transport preserves the distinction.

Custom Python `VacpBridgeClient` implementations check `call.has_params` before serializing `call.params`. A false value omits the parameter field. A true value includes explicit `None` as JSON `null`.

## vacp_progress

Speaks one plain sentence to the person watching: once before the first action, and once with `done: true` when the task is finished.

## Bridge shape

The tools call the page bridge that `getVacpBridge()` returns, typed as `VacpPageBridge`. The reads and execution come from `VacpWindowBridge`:

```ts
interface VacpWindowBridge {
  version: VacpSchemaVersion;
  observe(): Promise<VacpObservation> | VacpObservation;
  getCapabilities(request?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot> | VacpCapabilitiesSnapshot;
  getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  getState(): Promise<VacpStateSnapshot>;
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
}
```

## Example

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
    "table": "cars",
    "rowCount": 406,
    "columns": [
      { "name": "mpg", "type": "DOUBLE" },
      { "name": "weight", "type": "DOUBLE" }
    ]
  }
}
```
