# Tool contract

The agent tool contract exposes scoped graph and state views plus semantic execution. Both reads come from revisioned provider observations. Use `bridge.observe()` when graph, state, ownership, and freshness must be read together.

```text
vacp_observe()
vacp_capabilities(options?)
vacp_state(options?)
vacp_execute(name, params?, call_id?)
```

## vacp_observe

Returns one observation with graph, state, source ownership, revision, summaries, and output freshness. Use it when these values must describe the same read.

## vacp_capabilities

Returns a capabilities snapshot. This includes source descriptions, ownership, a semantic graph, and action descriptors for the current interface.

For a broad read, omit `refs` and `prefixes`. Do not use bare `vacp://` as a scope token.

## vacp_state

Returns state keyed by stable refs. Depending on the request, the response may be a full snapshot or an incremental update.

When `refs` includes a container ref such as a _View_ or _Visualization_, the scoped result includes descendant state entries under that container. This lets callers read the active _Widget_, _Selection_, and _DataHandle_ state for a view without enumerating every child ref first.

## vacp_execute

Executes a discovered action by its unique `name` with validated parameters. `operation.contract` identifies shared semantics independently of that routing name. Action descriptors identify the operation kind, input refs, affected refs, dynamic ref parameters, and produced results. The response includes the call id, a success flag, and either a result payload or an error payload.

## Bridge shape

```ts
interface VacpWindowBridge {
  version: VacpSchemaVersion;
  observe(): Promise<VacpObservation> | VacpObservation;
  getCapabilities(request?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot> | VacpCapabilitiesSnapshot;
  getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  getState(): Promise<VacpStateSnapshot> | VacpStateSnapshot;
  execute(call: VacpActionCall): Promise<VacpActionResult>;
}
```

## Example

```ts
const handleRef = 'vacp://vacp-examples/data/main';
const capabilities = await vacp_capabilities({ refs: [handleRef] });
const action = capabilities.graph.actions.find((action) => action.operation.contract === 'vacp.data_schema');
if (!action) throw new Error('Schema inspection is unavailable for this data handle');
await vacp_execute(action.name, { handleRef, detail: 'columns' }, 'call-1');
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
