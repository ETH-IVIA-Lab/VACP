# Connect an application

A custom provider exposes your application's controls, views, and data to VACP. This guide connects one HTML range input, a threshold between 0 and 100, and lets an agent set it.

<<< ../../examples/custom-integration/threshold.ts

The integration has three parts:

- `createVacpActions()` from `@vacp/sdk` defines operations with [Zod](https://zod.dev) schemas, a TypeScript schema library. `.params(schema)` publishes the schema to agents as JSON Schema and parses every call before the handler runs.
- `createVacpProvider()` from `@vacp/runtime` binds the source. `project()` returns the graph and state for one read, and `subscribe()` tells the runtime when a later read may differ.
- `installVacpRuntime()` from `@vacp/runtime-browser` composes the provider into a runtime and publishes it at `window.__vacp`.

After `connectThreshold(input)` runs, an agent or the browser console can set the threshold:

```js
await window.__vacp.execute(
  { callId: 'c1', name: 'threshold.set', params: { value: 42 } },
  { narration: 'Raising the threshold to 42.' },
);
// { callId: 'c1', ok: true, result: { value: 42 } }
```

## Describe operations

Each operation names its kind, its relationships, and its parameters:

```ts
actions
  .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
  .affects('vacp://example/threshold')
  .params(z.object({ value: z.number().min(0).max(100) }))
  .handle(({ value }) => setThreshold(value));
```

| Method                                | Sets                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `.operation(kind, name, description)` | `mutation`, `creation`, `evaluation`, or `query`, with the routing name       |
| `.title(text)`                        | A short label for interfaces                                                  |
| `.contract(id)`                       | A shared contract other sources also implement                                |
| `.input(ref)`                         | An entity the operation reads                                                 |
| `.affects(ref)`                       | An entity the operation may change                                            |
| `.produces(result)`                   | State, an entity, data, a visualization, or an artifact the operation creates |
| `.requires(ref)`                      | A node that must be [available](../availability/) for the operation to run    |
| `.params(schema)`                     | The Zod schema for `params`                                                   |
| `.focus(resolve)`                     | The entity [presence](../presence/) points at for a call                      |
| `.handle(handler)`                    | The function that applies the change and returns the result                   |

Call `.params()` before `.focus()` and `.handle()`. Both callbacks receive the parsed output: defaults filled in, coercions and transforms applied. VACP converts the schema with Zod's input mode once, when the operation is defined. A schema JSON Schema cannot express, such as `z.date()`, throws at definition. Accept JSON and transform it instead, for example `z.iso.datetime().transform((value) => new Date(value))`.

### Invalid parameters

A call whose parameters fail the schema changes nothing. Its result carries the issues:

```json
{
  "callId": "c2",
  "ok": false,
  "error": {
    "message": "Invalid parameters for action \"threshold.set\"",
    "details": {
      "code": "invalid-params",
      "issues": [{ "path": ["value"], "code": "too_big", "message": "Too big: expected number to be <=100" }]
    }
  }
}
```

Each issue has a `path` of field names and array indices, so an agent can correct the field without parsing the message. A union failure lists each branch's issues in `errors`. To report a domain failure from a handler, throw `new VacpActionError(message, details)` from `@vacp/protocol`. Its `details` reach the result unchanged. Any other exception reaches the result as its message alone.

## Report human changes

`subscribe()` tells the runtime that the source changed, and the runtime records the change as a `system` observation. `connectThreshold` also calls `runtime.refresh` from its input handler, which records the change with the person as its actor:

```ts
const onInput = () => {
  void runtime.refresh({ actor: { id: 'human', kind: 'human' }, message: 'Threshold changed' }).catch(() => {});
};
input.addEventListener('input', onInput);
```

The journal then records one observation with the human as its actor, and [replay](../provenance/) treats the change as the person's step.

## Support restoration

Replay and inspection surfaces restore recorded state through the `vacp.apply_state` contract. Inside `connectThreshold`, before creating the provider, register it with a preparation function that validates the recorded state and returns the change to apply:

```ts
import { registerVacpApplyStateAction } from '@vacp/runtime';

registerVacpApplyStateAction(
  actions.registry,
  (state) => {
    const next = z.object({ value: z.number().min(0).max(100) }).parse(state[ref]);
    return () => {
      input.value = String(next.value);
      return { applied: 1 };
    };
  },
  { affects: [ref] },
);
```

Preparation runs before anything changes. A state that fails to parse fails the restoration for this source, and other sources still restore.

## Expose data

Keep datasets in the system that owns them. Load the rows into DuckDB, register `vacp.data_sql` and `vacp.data_schema` with handlers from `@vacp/data-duckdb`, and project a `DataHandle` node for the table. Agents then query the rows with SQL, and the graph carries only the handle:

```ts
import { createDuckDbDataSchemaHandler, createDuckDbDataSqlHandler, createDuckDbWasmClient } from '@vacp/data-duckdb';
import { registerVacpDataSchemaAction, registerVacpDataSqlAction } from '@vacp/runtime';

const handleRef = 'vacp://example/scores';
const duckdb = createDuckDbWasmClient();
const loaded = duckdb.then((db) => db.loadObjectsAsTable('scores', rows));
const selectionWhere = () => `score >= ${input.valueAsNumber}`;

registerVacpDataSqlAction(
  actions.registry,
  createDuckDbDataSqlHandler({
    duckdb,
    resolveHandle: async (ref) => {
      if (ref !== handleRef) return null;
      await loaded;
      return { allSql: 'SELECT * FROM scores', selectedSql: `SELECT * FROM scores WHERE ${selectionWhere()}` };
    },
  }),
  { inputRefs: [handleRef] },
);
registerVacpDataSchemaAction(
  actions.registry,
  createDuckDbDataSchemaHandler({
    duckdb,
    resolveHandle: async (ref) => {
      if (ref !== handleRef) return null;
      await loaded;
      return { table: 'scores' };
    },
  }),
  { inputRefs: [handleRef] },
);
```

`resolveHandle` returns the SQL behind `vacp_all` and `vacp_handle`. Project the handle beside the other nodes, with the same predicate in its state:

```ts
nodes: [
  { ref: handleRef, kind: 'DataHandle', layer: 'DataLayer', title: 'Scores', data: { table: 'scores' } },
],
state: {
  [handleRef]: { kind: 'DataHandle', rowCount: rows.length, selectionWhere: selectionWhere() },
},
```

The [React dashboard example](https://github.com/ETH-IVIA-Lab/VACP/tree/main/examples/react-dashboard/src/vacp/data.ts) does the same for whichever dataset is active. [Data handles](../api/protocol#data-handles) lists every field.

## Release the integration

Call `dispose()` from the installation when the view unmounts. It detaches the installation's providers and releases their subscriptions. Once no providers remain at the global key, it disposes the runtime and removes `window.__vacp`.

Next, [compose several sources](../composition/) into one runtime, or add [agent presence](../presence/) to show an agent's steps on your interface.
