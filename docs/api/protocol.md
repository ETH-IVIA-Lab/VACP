# Protocol types

These types describe what every VACP package and the Python server exchange: refs, graphs, actions, observations, state, executions, and provenance records. They run in any JavaScript environment. [Runtime and page bridge](./runtime) describes the objects that produce them, and [Actions and providers](./actions#vacpprovider) the `VacpProvider` that returns them.

```ts
import type {
  ProvenanceRecord,
  VacpActionDescriptor,
  VacpActionExecutionContext,
  VacpActionRequest,
  VacpActionResult,
  VacpAvailability,
  VacpCapabilitiesSnapshot,
  VacpEdge,
  VacpEdgeKind,
  VacpExecution,
  VacpFocus,
  VacpFreshness,
  VacpGraph,
  VacpGraphFragment,
  VacpInteraction,
  VacpLayer,
  VacpNode,
  VacpNodeKind,
  VacpObservation,
  VacpOperationKind,
  VacpRef,
  VacpSourceDescription,
  VacpSourceId,
  VacpStateSnapshot,
  VacpStateUpdate,
  VacpTurnRecord,
  VacpWidgetOptionsResult,
} from '@ethivia/vacp-sdk';
```

## VacpRef

```ts
type VacpRef = `vacp://${string}`;
```

Names one entity and stays the same across reads.

## VacpSourceId

```ts
type VacpSourceId = `vacp-source://${string}`;
```

Names one analytical source in a composed view.

## VacpSourceDescription

```ts
type VacpSourceDescription<Data = Record<string, unknown>> = {
  id: VacpSourceId;
  type: string;
  title: string;
  description?: string;
  data?: Data;
};
```

`type` is an open family name such as `application`, `widget`, or `notebook`.

## VacpNode

```ts
type VacpNode<Data = Record<string, unknown>> = {
  ref: VacpRef;
  kind: VacpNodeKind;
  layer: VacpLayer;
  title?: string;
  description?: string;
  data?: Data;
  availability?: VacpAvailability;
};
```

One entity in the graph.

## VacpNodeKind

The core values are `App`, `View`, `Visualization`, `Mark`, `EncodingChannel`, `EncodedField`, `Legend`, `Axis`, `Selection`, `Param`, `Widget`, `DataHandle`, and `InteractionTarget`. Any other string is a kind a provider defines.

## VacpLayer

The core values are `ConfigLayer`, `ViewLayer`, `VisualizationLayer`, `DataLayer`, and `InteractionFeedbackLayer`. Any other string is a layer a provider defines.

## VacpEdge

```ts
type VacpEdge = { from: VacpRef; to: VacpRef; kind: VacpEdgeKind };
```

One relationship between two nodes.

## VacpEdgeKind

The core values are `contains`, `controls`, `derivedFrom`, and `targets`. Any other string is a relationship a provider defines.

## VacpGraph

```ts
type VacpGraph<NodeData = Record<string, unknown>> = {
  sources: VacpSourceDescription[];
  ownership: { nodes: Record<VacpRef, VacpSourceId>; actions: Record<string, VacpSourceId> };
  nodes: VacpNode<NodeData>[];
  edges: VacpEdge[];
  actions: VacpActionDescriptor[];
};
```

The composed graph. `ownership` maps each node and action to the source that routes it.

## VacpGraphFragment

```ts
type VacpGraphFragment<NodeData = Record<string, unknown>> = Omit<VacpGraph<NodeData>, 'sources' | 'ownership'>;
```

One provider's graph, before composition adds `sources` and `ownership`.

## VacpAvailability

```ts
type VacpAvailability = { requires?: readonly VacpRef[]; unavailable?: string };
```

The availability of a node or action. Omitting it means available. The [Availability guide](../availability/) shows how to declare it.

- `requires`: nodes that must all be available. A missing ref or a cycle makes the graph invalid.
- `unavailable`: a nonempty reason the host gives for the capability being unavailable.

## VacpActionDescriptor

```ts
type VacpActionDescriptor<Parameters = Record<string, unknown>> = {
  name: string;
  title?: string;
  description: string;
  parameters?: Parameters; // JSON Schema
  availability?: VacpAvailability;
  operation: {
    kind: VacpOperationKind;
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
```

One action.

- `name`: the unique execution identity across the composed graph.
- `operation.contract`: a shared meaning independent of `name`, such as a [standard contract](#standard-contracts).
- `operation.inputRefs`: the entities the action reads.
- `operation.affects`: the entities that may change when it succeeds.
- `operation.refParameters`: parameters whose values are refs resolved when the action is called.
- `operation.results`: what the action produces.

## VacpOperationKind

```ts
type VacpOperationKind = 'mutation' | 'creation' | 'evaluation' | 'query';
```

Declares what an action does to the analysis. A `query` leaves the analysis as it was, so it produces no [checkpoint](./provenance#provenancecheckpoints) and never ends a review. Every other kind counts as a change.

## VacpActionRequest

```ts
type VacpActionRequest<Params = unknown, Name extends string = string> = {
  callId?: string | null;
  name: Name;
  params?: Params;
};
```

What a caller passes to [`execute`](./runtime#execute). The runtime assigns `callId` when it is absent, null, or made only of [Unicode White_Space](https://www.unicode.org/reports/tr44/#White_Space) characters, and keeps any other value as written.

## VacpActionResult

```ts
type VacpActionResult<Result = unknown, ErrorDetails = unknown> =
  | { callId: string; ok: true; result?: Result }
  | { callId: string; ok: false; error: { message: string; details?: ErrorDetails } };
```

The outcome of one call. It carries the same `callId` as its execution and provenance record.

## VacpActionExecutionContext

```ts
type VacpActionExecutionContext = {
  actor: VacpActor;
  signal?: AbortSignal;
  narration?: string;
  restoration?: { id: string; entryId?: string };
};
```

The options an action runs with, passed to every handler and to a prepared action's `execute`. They belong to the host and never travel inside a call.

- `actor`: the actor the call is attributed to, resolved once by the runtime.
- `signal`: aborts when the caller cancels the call or the provider is replaced.
- `narration`: the step's sentence.
- `restoration`: marks a call that restores recorded state.

## Standard contracts

| Contract              | Parameters                              | Result                                                 |
| --------------------- | --------------------------------------- | ------------------------------------------------------ |
| `vacp.apply_state`    | `{ state: Record<VacpRef, unknown> }`   | Defined by the provider, with the refs it skipped      |
| `vacp.data_sql`       | `{ handleRef, sql, format?, maxRows? }` | [SQL rows or Arrow](./data#createduckdbdatasqlhandler) |
| `vacp.data_schema`    | `{ handleRef, detail?, sampleRows? }`   | [`VacpDataSchemaResult`](./data#vacpdataschemaresult)  |
| `vacp.widget_options` | `{ ref, offset?, limit?, query? }`      | [`VacpWidgetOptionsResult`](#vacpwidgetoptionsresult)  |

An action that implements a contract sets `operation.contract` to its name. `vacp.data_sql` returns at most 500 JSON rows by default.

## VacpWidgetOptionsResult

```ts
type VacpWidgetOptionsResult =
  | {
      ref: VacpRef;
      offset: number;
      limit: number;
      count: number;
      truncated: boolean;
      options: Array<{ value: unknown; label?: string }>;
    }
  | { ref: VacpRef; kind: 'Widget'; readError: string };
```

One page of a widget's options, or `readError` when the widget could not be read.

## VacpObservation

```ts
type VacpObservation<NodeData = Record<string, unknown>> = {
  version: '0.1.0';
  revision: string;
  observedAt: string;
  graph: VacpGraph<NodeData>;
  state: Record<VacpRef, unknown>;
  summary?: Record<VacpRef, unknown>;
  freshness?: Record<VacpRef, VacpFreshness>;
};
```

One coherent read of the graph, state, summaries, and output freshness.

## VacpFreshness

```ts
type VacpFreshness = {
  status: 'current' | 'stale' | 'running' | 'error';
  inputRevision?: string;
  outputRevision?: string;
  message?: string;
};
```

Whether an output reflects its inputs. `inputRevision` is the input state the output is based on, and `outputRevision` is the output the ref holds. A ref without freshness has unknown freshness.

## VacpCapabilitiesSnapshot

```ts
type VacpCapabilitiesSnapshot<NodeData = Record<string, unknown>> = {
  version: '0.1.0';
  createdAt: string;
  graph: VacpGraph<NodeData>;
};
```

The result of `getCapabilities`, which a [`VacpCapabilitiesRequest`](./agent#vacpcapabilitiesrequest) scopes.

## VacpStateSnapshot

```ts
type VacpStateSnapshot<State = Record<VacpRef, unknown>, Summary = Record<VacpRef, unknown>> = {
  version: '0.1.0';
  createdAt: string;
  state: State;
  summary?: Summary;
};
```

State and optional summaries keyed by ref.

## VacpStateUpdate

```ts
type VacpStateUpdate =
  | {
      version: '0.1.0';
      createdAt: string;
      mode: 'full';
      token: string;
      scope?: { refs?: VacpRef[] };
      snapshot: VacpStateSnapshot;
    }
  | {
      version: '0.1.0';
      createdAt: string;
      mode: 'delta';
      token: string;
      baseToken: string;
      scope?: { refs?: VacpRef[] };
      delta: {
        changed: Record<VacpRef, unknown>;
        removed: VacpRef[];
        summaryChanged?: Record<VacpRef, unknown>;
        summaryRemoved?: VacpRef[];
      };
    };
```

The result of `getState`, which a [`VacpStateRequest`](./agent#vacpstaterequest) scopes. Pass `token` as `since` on the next read.

## VacpExecution

```ts
type VacpExecution = {
  id: string;
  sequence: number;
  callId: string;
  name: string;
  title?: string;
  operationKind?: VacpOperationKind;
  actor: VacpActor;
  activityId?: string;
  narration?: string;
  sourceId?: VacpSourceId;
  bindingId?: string;
  restoration?: { id: string; entryId?: string };
  phase: 'accepted' | 'prepared' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  at: string;
  intent?: { focus?: VacpFocus; affects: VacpRef[] };
  message?: string;
};
```

One call's lifecycle, published by [`VacpExecutionSource`](./runtime#vacpexecutionsource). Execution completion is independent of the freshness of affected outputs.

- `sequence`: monotonic within the runtime.
- `activityId`: the actor's turn when the execution began. Steps of one request share it.
- `narration`: the step's sentence, fixed when the runtime accepts the step.
- `phase`: `succeeded`, `failed`, and `cancelled` are settled.
- `message`: a failure summary.

## VacpFocus

```ts
type VacpFocus<Detail = unknown> = { ref: VacpRef; detail?: Detail; interaction?: VacpInteraction };
```

What a step points at. `detail` is serializable data the provider owns.

## VacpInteraction

```ts
type VacpInteraction = {
  kind: 'point' | 'activate' | 'brush' | 'drag' | 'pan' | 'zoom' | 'edit' | 'resize' | (string & {});
  axis?: 'x' | 'y' | 'xy';
  direction?: 'in' | 'out';
};
```

What kind of interaction a step performs. A renderer picks its assets and feedback from it.

## ProvenanceRecord

```ts
type ProvenanceRecord = { id: string; at: string; message?: string } & (
  | {
      kind: 'action';
      execution: VacpExecution; // phase: 'succeeded' | 'failed' | 'cancelled'
      call: VacpActionRequest & { callId: string };
      result: VacpActionResult;
      captureErrors?: readonly { field: 'result'; message: string }[];
      beforeCaptureId?: string;
      before?: VacpObservation;
      observation?: VacpObservation;
    }
  | {
      kind: 'observation';
      cause:
        | { kind: 'external' }
        | {
            kind: 'concurrent';
            executions: readonly { executionId: string; restoration?: { id: string; entryId?: string } }[];
          };
      actor: VacpActor;
      observation: VacpObservation;
      focus?: VacpFocus;
    }
  | { kind: 'session'; actor: VacpActor }
  | {
      kind: 'turn';
      actor: VacpActor;
      activityId: string;
      outcome: 'completed' | 'failed' | 'cancelled';
      opening?: string;
    }
);
```

One captured fact in the runtime's [provenance](./provenance#provenancesource).

- `action`: a finished call. `before` and `observation` hold the state around it. `captureErrors` lists fields left out because they could not be captured. Equal `beforeCaptureId` values prove that two records share the read behind `before`, and distinct reads have distinct IDs even when their values match.
- `observation`: a state read. `cause` is `external` for a change outside any execution, and `concurrent` while listed executions ran.
- `session`: a session boundary.
- `turn`: an agent's turn ended. `message` holds its closing sentence and `opening` its first one. The turn's steps carry the same `activityId` on their executions.

## VacpTurnRecord

```ts
type VacpTurnRecord = Extract<ProvenanceRecord, { kind: 'turn' }>;
```

The record of one finished agent turn.

## Data handles

A `DataHandle` node stands for a table its provider can query. Its node `data` and its state carry these fields:

| Field            | Where       | Holds                                                                                                 |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `table`          | node `data` | The relation the handle's SQL reads                                                                   |
| `columns`        | node `data` | That relation's columns, once the provider knows them                                                 |
| `metadata`       | node `data` | What the data is, from the host's `data.describe` hook                                                |
| `rowCount`       | state       | The rows the relation holds at the read, or `null` when neither the provider nor its host has a count |
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

The node's description says which rows `vacp_handle` and `vacp_all` hold. [`vacpDataHandle`](./data#vacpdatahandle) builds these fields.
