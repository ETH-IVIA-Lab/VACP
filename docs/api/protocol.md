# Protocol records

`@vacp/protocol` defines the records every VACP package and the Python server exchange. It runs in any JavaScript environment. `@vacp/protocol/validation` adds Zod parsers for payloads that arrive over a wire.

## Identity

```ts
type VacpRef = `vacp://${string}`;
type VacpSourceId = `vacp-source://${string}`;
type VacpSourceDescription = { id: VacpSourceId; type: string; title: string; description?: string; data?: object };
```

A ref names one entity and stays the same across reads. `isVacpRef(value)` checks the prefix. A source's `type` is an open family name such as `application`, `widget`, or `notebook`.

## Graph

```ts
type VacpNode = {
  ref: VacpRef;
  kind: VacpNodeKind;
  layer: VacpLayer;
  title?: string;
  description?: string;
  data?: object;
  availability?: VacpAvailability;
};
type VacpEdge = { from: VacpRef; to: VacpRef; kind: VacpEdgeKind };
type VacpGraph = {
  sources: VacpSourceDescription[];
  ownership: { nodes: Record<VacpRef, VacpSourceId>; actions: Record<string, VacpSourceId> };
  nodes: VacpNode[];
  edges: VacpEdge[];
  actions: VacpActionDescriptor[];
};
type VacpGraphFragment = Omit<VacpGraph, 'sources' | 'ownership'>;
```

| Type           | Core values                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VacpNodeKind` | `App`, `View`, `Visualization`, `Mark`, `EncodingChannel`, `EncodedField`, `Legend`, `Axis`, `Selection`, `Param`, `Widget`, `DataHandle`, `InteractionTarget` |
| `VacpLayer`    | `ConfigLayer`, `ViewLayer`, `VisualizationLayer`, `DataLayer`, `InteractionFeedbackLayer`                                                                      |
| `VacpEdgeKind` | `contains`, `controls`, `derivedFrom`, `targets`                                                                                                               |

Each type also accepts any other string, for kinds, layers, and relationships a provider defines. A provider returns a `VacpGraphFragment`. Composition adds `sources` and `ownership`.

## Availability

```ts
type VacpAvailability = { requires?: readonly VacpRef[]; unavailable?: string };
type VacpAvailabilityStatus = { available: boolean; blockedBy: readonly VacpRef[]; reason?: string };
```

`resolveVacpAvailability(graph)` resolves every node and operation and throws on a missing prerequisite or a cycle. `assertVacpActionAvailable(resolution, call)` throws a `VacpAvailabilityError` whose `details` is a `VacpAvailabilityFailure`:

```ts
type VacpAvailabilityFailure =
  | { code: 'unknown-action'; action: string }
  | { code: 'action-unavailable'; action: string; status: VacpAvailabilityStatus }
  | { code: 'input-unavailable'; action: string; ref: VacpRef; status?: VacpAvailabilityStatus };
```

`resolveVacpObservation(observation)` returns the complete `inspection`, the disclosed `observation`, and the `availability` resolution of one read.

## Operations

```ts
type VacpActionDescriptor = {
  name: string;
  title?: string;
  description: string;
  parameters?: object; // JSON Schema
  availability?: VacpAvailability;
  operation: {
    kind: 'mutation' | 'creation' | 'evaluation' | 'query';
    contract?: string;
    inputRefs?: VacpRef[];
    affects?: VacpRef[];
    refParameters?: Array<{ parameter: string; role: 'input' | 'affects' }>;
    results?: Array<{
      role: 'state' | 'entity' | 'data' | 'visualization' | 'artifact';
      ref?: VacpRef;
      kind?: string;
      mediaType?: string;
      description?: string;
    }>;
  };
};
type VacpActionCall = { callId: string; name: string; params?: unknown };
type VacpActionResult =
  | { callId: string; ok: true; result?: unknown }
  | { callId: string; ok: false; error: { message: string; details?: unknown } };
```

`primaryOperationRef(descriptor)` returns the operation's first `affects` ref, else its first `inputRefs` ref, else its first result ref.

```ts
type VacpActionExecutionOptions = {
  signal?: AbortSignal;
  actor?: VacpActor;
  narration?: string;
  restoration?: { id: string; entryId?: string };
};
```

Execution options belong to the host and never travel inside a call. `narration` is the step's sentence, parsed by `parseVacpNarration`. `restoration` marks a call that restores recorded state.

`new VacpActionError(message, details)` reports a failure whose `details` reach the result unchanged.

### Standard contracts

| Constant                     | Value                 | Parameters                              | Result                              |
| ---------------------------- | --------------------- | --------------------------------------- | ----------------------------------- |
| `VACP_APPLY_STATE_ACTION`    | `vacp.apply_state`    | `{ state: Record<VacpRef, unknown> }`   | Provider-defined, with skipped refs |
| `VACP_DATA_SQL_ACTION`       | `vacp.data_sql`       | `{ handleRef, sql, format?, maxRows? }` | `VacpDataSqlResult`                 |
| `VACP_DATA_SCHEMA_ACTION`    | `vacp.data_schema`    | `{ handleRef, detail?, sampleRows? }`   | `VacpDataSchemaResult`              |
| `VACP_WIDGET_OPTIONS_ACTION` | `vacp.widget_options` | `{ ref, offset?, limit?, query? }`      | `VacpWidgetOptionsResult`           |

`vacp.data_sql` returns `{ format: 'json', resolvedSql, columns, rows, truncated }` by default, with at most 500 rows. `format: 'arrow_ipc_base64'` returns `{ format, resolvedSql, arrowIpcBase64 }`. `vacp.data_schema` describes `vacp_handle`, and `vacp_all` when it reads another relation. `detail: 'full'` adds bounded numeric, temporal, and top-category summaries.

## Observations and state

```ts
type VacpObservation = {
  version: '0.1.0';
  revision: string;
  observedAt: string;
  graph: VacpGraph;
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
};
type VacpFreshness = {
  status: 'current' | 'stale' | 'running' | 'error';
  inputRevision?: string;
  outputRevision?: string;
  message?: string;
};
type VacpCapabilitiesRequest = { refs?; prefixes?; kinds?; layers?; includeActions?; includeEdges?; includeNodeData? };
type VacpStateRequest = { since?: string; refs?: VacpRef[]; includeSummary?: boolean };
type VacpStateUpdate =
  | { mode: 'full'; token: string; snapshot: { state; summary? }; scope?; version; createdAt }
  | {
      mode: 'delta';
      token: string;
      baseToken: string;
      delta: { changed; removed; summaryChanged?; summaryRemoved? };
      scope?;
      version;
      createdAt;
    };
```

`VACP_SCHEMA_VERSION` is `'0.1.0'`. A state read without `since`, or with an unknown token, returns `mode: 'full'`. With a known token it returns the changes since that read. `includeActions`, `includeEdges`, and `includeNodeData` default to `true` on the bridge. A scoped capability read keeps the transitive prerequisites of matching nodes as context.

## Bridges and providers

```ts
interface VacpWindowBridge {
  readonly version: '0.1.0';
  observe(): Promise<VacpObservation>;
  getCapabilities(request?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot>;
  getState(request?: VacpStateRequest): Promise<VacpStateUpdate>;
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
}
interface VacpPageBridge extends VacpWindowBridge, VacpProvenanceSource, VacpAgentActivityControl, VacpExecutionSource {
  readonly runtimeId: string;
  readonly sessionKey: string | undefined;
  inspect(): Promise<VacpObservation>;
  refresh(options?: { actor?: VacpActor; message?: string; focus?: VacpFocus }): Promise<VacpStateSnapshot>;
}
interface VacpProvider {
  readonly source: VacpSourceDescription;
  observe(): VacpProviderObservation | Promise<VacpProviderObservation>;
  prepare(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpPreparedAction>;
  subscribe(invalidate: () => void): () => void;
  dispose?(): void;
}
type VacpPreparedAction = {
  intent: { focus?: VacpFocus; affects: VacpRef[] };
  execute(options?): Promise<VacpActionResult>;
};
```

`VacpWindowBridge` is what agent transports read. `VacpPageBridge` is what a page publishes at `window.__vacp`. A provider's `observe()` returns `{ revision, observedAt, graph: VacpGraphFragment, state, summary?, freshness? }`, and its revision changes whenever any part changes. `prepare` validates the call and resolves its target without changing the source. The returned `execute` runs once.

## Actors, executions, and activity

```ts
type VacpActor = { id: string; kind: 'agent' | 'human' | 'system'; label?: string };
type VacpFocus = { ref: VacpRef; detail?: unknown; interaction?: VacpInteraction };
type VacpInteraction = {
  kind: 'point' | 'activate' | 'brush' | 'drag' | 'pan' | 'zoom' | 'edit' | 'resize' | string;
  axis?: 'x' | 'y' | 'xy';
  direction?: 'in' | 'out';
};
```

`vacpAgentActor` is `{ id: 'agent', kind: 'agent', label: 'Agent' }`, the actor every agent transport uses when the host names none. `vacpHumanActor` is `{ id: 'human', kind: 'human', label: 'You' }`, the actor of restorations.

A `VacpExecution` describes one call's lifecycle: `id`, monotonic `sequence`, `callId`, `name`, `actor`, `activityId`, `narration`, `sourceId`, `intent`, and `phase`, one of `accepted`, `prepared`, `running`, `succeeded`, `failed`, or `cancelled`. `isVacpExecutionSettled(execution)` is true for the last three. `VacpExecutionSource` publishes executions through `getActiveExecutions()` and `subscribeExecutions(listener)`. `VacpExecutionControl.addExecutionGate(gate, { timeoutMs, stage })` adds a bounded wait before or after execution.

`VacpAgentActivityControl` publishes public progress:

| Method                                             | Behavior                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `beginAgentActivity({ actor, summary?, signal? })` | Opens a turn and returns a handle with `update(summary)` and `end({ outcome?, summary? })`                       |
| `narrate({ actor, message, done?, signal? })`      | The first sentence opens a turn or joins one the host began, later sentences replace its words, `done` closes it |

## Provenance

`VacpProvenanceRecord` is a union on `kind`: `action`, `observation`, `turn`, and `session`. See [Provenance and replay](../provenance/) for each record's fields. `VacpProvenanceSource` provides `getProvenance()` and `subscribeProvenance(listener)`.

| Function                  | Returns                                                   |
| ------------------------- | --------------------------------------------------------- |
| `provenanceActor(record)` | The record's actor, from its execution for action records |
| `provenanceFocus(record)` | The record's focus, when it has one                       |
| `provenanceTurn(record)`  | The `activityId` of the turn the record belongs to        |

```ts
type VacpRestore = (
  state: Readonly<Record<VacpRef, unknown>>,
  options: VacpActionExecutionOptions,
) => Promise<VacpActionResult>;
```

`VacpRestore` is the restoration port replay controllers and inspector clients accept.

## Data handles

A `DataHandle` node stands for a table its provider can query. Its node `data` and its state carry these fields:

| Field            | Where       | Holds                                                                                                 |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `table`          | node `data` | The relation the handle's SQL reads                                                                   |
| `columns`        | node `data` | That relation's columns, once the provider knows them                                                 |
| `metadata`       | node `data` | What the data is, from the host's `data.describe` hook                                                |
| `rowCount`       | state       | The rows the relation holds now, or `null` when neither the provider nor its host has a current count |
| `selectionWhere` | state       | The predicate the current selections add, or `null` when none narrows `vacp_handle`                   |
| `stats`          | state       | Current figures from the host's `data.describe` hook                                                  |

A handle's node and its state in an observation:

```json
{
  "graph": {
    "nodes": [
      {
        "ref": "vacp://vacp-examples/data/main",
        "kind": "DataHandle",
        "layer": "DataLayer",
        "data": {
          "table": "cars",
          "columns": [
            { "name": "mpg", "type": "DOUBLE" },
            { "name": "weight", "type": "DOUBLE" }
          ]
        }
      }
    ]
  },
  "state": {
    "vacp://vacp-examples/data/main": {
      "kind": "DataHandle",
      "rowCount": 406,
      "selectionWhere": "(\"mpg\" >= 20 AND \"mpg\" <= 30)"
    }
  }
}
```

The node's description says which rows `vacp_handle` and `vacp_all` hold. `vacp.data_schema` describes the relation behind `vacp_handle` under the `vacp_handle` key. When `vacp_all` reads a different relation, the result also describes it under the `vacp_all` key.

`vacpDataHandle(read, describe?)` builds the node `data` and state from what a provider read and what its host's `VacpDataHandleDescriber` states. A host's row count replaces the provider's, as for vgplot's Mosaic tables, which report no count of their own. A describer that throws states nothing. `VacpDataHandleData`, `VacpDataHandleState`, and `VacpDataHandleFacts` type these shapes.

## Agent tools

| Export                                                                | Contents                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `vacpAgentTools`                                                      | Each tool's name, input fields, and description                                               |
| `vacpAgentToolGuidance`                                               | The shared instructions the default agent and the MCP server give the model                   |
| `vacpNarrationGuidance`, `vacpProgressGuidance`, `vacpProgressFields` | The wording of the narration field and the progress tool                                      |
| `parseVacpNarration(value, field?)`                                   | A trimmed sentence of at most `VACP_NARRATION_MAX_LENGTH` (280) code points, or a `TypeError` |
| `vacpToolCapabilitiesRequest(input)`, `vacpToolStateRequest(input)`   | The bridge request for a tool's input                                                         |
| `vacpToolRead(read)`                                                  | A graph read without source ownership                                                         |
| `vacpToolResult(value, limits?)`                                      | The value cut to `VACP_TOOL_RESULT_LIMITS`                                                    |

See [Agent tools](./agent-tools) for the bounds.

## Values and utilities

| Export                           | Behavior                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stableStringify(value)`         | JSON with sorted object keys                                                                                                                          |
| `fnv1a64Hex(text)`               | A 64-bit FNV-1a hash as hexadecimal                                                                                                                   |
| `sameVacpValue(a, b)`            | Structural equality of JSON values                                                                                                                    |
| `captureVacpValue(value)`        | A reader function. Plain records and arrays are cloned once and frozen for every reader. Dates, Maps, and other mutable built-ins are copied per read |
| `abortable(signal, run)`         | Runs `run` and rejects with the signal's reason when it aborts first                                                                                  |
| `parseVacpInstant(text, clock)`  | An ISO date or date-time on a `local` or `utc` clock, as epoch milliseconds. Throws a `RangeError` for other text                                     |
| `formatVacpWallClock(ms, clock)` | Wall-clock text for an instant on a clock                                                                                                             |

## Validation

`@vacp/protocol/validation` exports Zod parsers for untrusted payloads: `parseObservation`, `parseActionResult`, `parseCapabilitiesRequest`, `parseStateRequest`, and `vacpRefSchema`. Each returns the typed record or throws a Zod error.
