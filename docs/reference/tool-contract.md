# Tool contract

Transports expose a small, stable tool surface. All of them call the same in-page bridge and return structured snapshots and action results.

```text
vacp_capabilities(options?)
vacp_state(options?)
vacp_execute(name, params?, call_id?)
```

## vacp_capabilities

Returns a capabilities snapshot. This includes a semantic graph and action descriptors for the current interface.

For a broad read, omit `refs` and `prefixes`. Do not use bare `vacp://` as a scope token.

## vacp_state

Returns state keyed by stable refs. Depending on the request, the response may be a full snapshot or an incremental update.

When `refs` includes a container ref such as a _View_ or _Visualization_, the scoped result includes descendant state entries under that container. This lets callers read the active _Widget_, _Selection_, and _DataHandle_ state for a view without enumerating every child ref first.

## vacp_execute

Executes a named action with validated parameters. The response includes the call id, a success flag, and either a result payload or an error payload.

## Bridge shape

```ts
interface VacpWindowBridge {
  version: VacpSchemaVersion;
  getCapabilities(request?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot> | VacpCapabilitiesSnapshot;
  getState(request: VacpStateRequest): Promise<VacpStateUpdate>;
  getState(): Promise<VacpStateSnapshot> | VacpStateSnapshot;
  execute(call: VacpActionCall): Promise<VacpActionResult>;
}
```

## Example

```ts
await vacp_execute('vacp.data_schema', { handleRef: 'vacp://vacp-examples/data/main', detail: 'columns' }, 'call-1');
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
