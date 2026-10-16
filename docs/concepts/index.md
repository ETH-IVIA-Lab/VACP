# Core concepts

An observation is one read of a page's analysis: the graph of entities and operations, the state of each entity, and whether each output is current. Agents, presence, replay, and inspection surfaces all start from an observation. The examples use the threshold integration from [Connect an application](../integrate/), one range input that controls a threshold between 0 and 100.

## Refs

A ref is a stable identifier for one analytical entity, written as a `vacp://` URI:

```text
vacp://example/threshold
vacp://analysis/overview/scatter/param/brush
```

A provider derives refs from its own model, such as a view ID, a parameter name, or a mark index. A ref stays the same across rerenders and across reads, so an agent can name an entity it saw in an earlier read. Agents treat refs as opaque. They read refs from the graph and pass them back unchanged.

## Sources and ownership

A source is one system that owns analytical values, identified by a `vacp-source://` ID. A provider binds one source and contributes its part of the graph. When the runtime composes several providers, it records which source owns each node and each operation:

```json
{
  "sources": [{ "id": "vacp-source://example/threshold", "type": "control", "title": "Threshold control" }],
  "ownership": {
    "nodes": { "vacp://example/threshold": "vacp-source://example/threshold" },
    "actions": { "threshold.set": "vacp-source://example/threshold" }
  }
}
```

Each node and each operation has exactly one owner. Edges may cross sources, so a widget in one source can control a chart in another. [Compose sources](../composition/) covers several providers in one runtime.

## The graph

The graph describes what exists. `nodes` lists the entities, `edges` the relationships between them, and `actions` the operations.

```json
{
  "nodes": [{ "ref": "vacp://example/threshold", "kind": "Param", "layer": "ConfigLayer", "title": "Threshold" }],
  "edges": [],
  "actions": [
    {
      "name": "threshold.set",
      "description": "Set the threshold between 0 and 100",
      "operation": { "kind": "mutation", "affects": ["vacp://example/threshold"] }
    }
  ]
}
```

- `kind` names what the entity is: `View`, `Visualization`, `Mark`, `Selection`, `Param`, `Widget`, `DataHandle`, and other core kinds, or any string a provider defines.
- `layer` groups entities by role: `ConfigLayer`, `ViewLayer`, `VisualizationLayer`, `DataLayer`, or `InteractionFeedbackLayer`.
- Edges have a `kind` such as `contains`, `controls`, `derivedFrom`, or `targets`.

Containment alone carries no analytical meaning. A provider adds `controls` or `derivedFrom` when it knows that a control filters data or that a chart reads it.

## State and summaries

State holds the current value of each entity, keyed by ref. Values are JSON:

```json
{ "state": { "vacp://example/threshold": { "value": 42 } } }
```

A selection's state is its range or its selected points in data units, such as `[22, 28]` for an age brush in years. A summary, keyed the same way, holds a short description of a value too large for state, such as a row count or a domain.

## Freshness

Some outputs lag behind their inputs, such as a chart that recomputes after a filter changes. Freshness reports, per output, whether it reflects its current input:

```json
{
  "freshness": {
    "vacp://analysis/overview/scatter": { "status": "current", "inputRevision": "r12", "outputRevision": "r12" }
  }
}
```

The status is `current`, `stale`, `running`, or `error`. A provider reports `current` only when the source states that its output matches an input revision. An output without a freshness record has unknown freshness.

## Availability

A provider publishes its complete catalog, and each node or operation can state when it is usable. Agent reads disclose only what is available now, while `inspect()` returns the complete catalog for inspection surfaces. Execution checks availability again before it applies a change. [Declare availability](../availability/) gives the rules.

## Observations

An observation combines the graph, state, summaries, ownership, and freshness, with a `revision` that changes whenever any of them changes:

```js
const observation = await window.__vacp.observe();
// { version, revision, observedAt, graph, state, summary, freshness }
```

Use `observe()` when values must describe the same moment, as [Compose sources](../composition/#read-several-sources-at-once) explains. `getCapabilities()` and `getState()` return scoped views of the same data, and `getState({ since: token })` returns only what changed since an earlier read.

## Operations

An operation is a named change or query that an agent or an interface can execute. The protocol calls its record an action: operations appear in `graph.actions`, each described by a `VacpActionDescriptor`, and `execute()` takes a `VacpActionCall`. The descriptor states what the operation does to the analysis:

```json
{
  "name": "threshold.set",
  "description": "Set the threshold between 0 and 100",
  "parameters": {
    "type": "object",
    "properties": { "value": { "type": "number", "minimum": 0, "maximum": 100 } },
    "required": ["value"]
  },
  "operation": { "kind": "mutation", "affects": ["vacp://example/threshold"] }
}
```

| Field                     | Meaning                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `name`                    | The routing name, unique across the composed graph                         |
| `parameters`              | [JSON Schema](https://json-schema.org) for the call's `params`             |
| `operation.kind`          | `mutation`, `creation`, `evaluation`, or `query`                           |
| `operation.contract`      | A shared meaning several sources can implement, such as `vacp.data_sql`    |
| `operation.inputRefs`     | Existing entities whose values the operation reads                         |
| `operation.affects`       | Existing entities the operation may change                                 |
| `operation.refParameters` | Parameters whose values are refs                                           |
| `operation.results`       | State, entities, data, visualizations, or artifacts the operation produces |

A call runs in two phases. Preparation validates every parameter and resolves the native target without changing anything. Execution then applies the change once. A call with invalid parameters fails during preparation with `error.details.code: 'invalid-params'` and one issue per field, and the analysis stays as it was.

```js
await window.__vacp.execute({ callId: 'c1', name: 'threshold.set', params: { value: 42 } });
// { callId: 'c1', ok: true, result: { value: 42 } }
```

Several sources can implement one contract under different names, so an agent [finds an operation by its contract](../composition/#find-an-operation-by-contract) and then executes its `name`.

### Standard contracts

| Contract              | Purpose                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `vacp.apply_state`    | Apply recorded state to a source, for replay and restoration          |
| `vacp.data_sql`       | Run a SQL query over a data handle's rows                             |
| `vacp.data_schema`    | Read a data handle's columns, types, row count, and bounded summaries |
| `vacp.widget_options` | Page through the options of a menu or search widget                   |

[Protocol records](../api/protocol#standard-contracts) lists each contract's parameters.

## Data handles

A `DataHandle` node stands for a table the application already holds, so the graph carries the handle and the rows stay in their database. Its `vacp.data_sql` operation reads two relations:

- `vacp_handle` holds the rows the view shows now, narrowed by the current selections.
- `vacp_all` holds every row the source loaded.

```sql
SELECT sport, count(*) AS athletes FROM vacp_handle GROUP BY sport ORDER BY athletes DESC
```

[Data handles](../api/protocol#data-handles) lists the fields of a handle's node and state.

## Actors, turns, and narration

Every change has an actor: an `agent`, a `human`, or the `system`. The host supplies the actor with the call. Model output never sets it.

A turn is one agent request. It opens with the agent's first sentence or its first step, and it closes with the closing sentence. Each step carries its own sentence for the person watching, passed as `narration`. The progress tool adds an opening sentence before the first step and a closing sentence when the request is done. [Agent presence](../presence/) shows each sentence as its step begins, and replay shows the same words.

## Provenance

The runtime records every completed operation and every observed change in a journal of immutable records: operations with their actor and narration, changes a person made in the page, turn endings, and session boundaries. `@vacp/provenance-core` derives checkpoints from these records, and a viewer restores a checkpoint through each source's `vacp.apply_state` operation. [Provenance and replay](../provenance/) covers the journal and restoration.

Next, [connect an application](../integrate/), or add VACP to a [Vega-Lite](../vega-lite/) or [Mosaic vgplot](../vgplot/) view.
