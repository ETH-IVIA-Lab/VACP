# Custom provider

A custom [provider](../concepts/#provider) lets an agent read and change your application's own controls. This guide connects one HTML range input, a threshold between 0 and 100, and lets an agent set it.

```bash
pnpm add @ethivia/vacp-sdk zod
```

<<< ../../examples/custom-integration/threshold.ts

The example uses three functions from `@ethivia/vacp-sdk`:

- `createVacpActions()` defines actions. `.params()` takes a [Zod](https://zod.dev) schema, which agents receive as JSON Schema. The runtime parses every call against it before the handler runs.
- `createVacpProvider()` binds the source. `project()` returns the graph and state for one read. VACP adds the actions from `actions`.
- `installVacpRuntime()` composes the provider into a runtime and publishes the page bridge at `window.__vacp`.

After `connectThreshold(input)` runs, an agent or the browser console can set the threshold:

```js
await window.__vacp.execute(
  { name: 'threshold.set', params: { value: 42 } },
  { narration: 'Raising the threshold to 42.' },
);
// { callId: '7c9e6679-7425-40de-944b-e07fc1f90ae7', ok: true, result: { value: 42 } }
```

## Describe actions

Add each further control the same way: a `.operation()` on the same `actions`, with its own ref, and a node in `project()`.

`.operation(kind, name, description)` starts an action. `kind` is `mutation`, `creation`, `evaluation`, or `query`. Pass `.affects(...refs)` the entities the action changes and `.input(...refs)` the entities it reads, so agents can find the action from the entity. Call `.params()` before `.focus()` and `.handle()`, which both receive the parsed parameters.

A call whose parameters fail the schema changes nothing. Its result has `ok: false` and lists each issue with the `path` of the failing field. To report a domain failure from a handler, throw `new VacpActionError(message, details)`, and `details` reaches the agent unchanged.

The [Actions and providers reference](../api/actions) lists every builder method and the error shape.

## Report human changes

When the person changes the source, call `runtime.record()` with the actor. The example does this from its `onChange` listener with `vacpHumanActor` from `@ethivia/vacp-sdk`. [Provenance](../provenance/) then shows the change as the person's step.

For a change that nobody attributes, such as a timer or a data reload, pass `subscribe` to `createVacpProvider` and call `invalidate`. The runtime records those changes as `system`, and it fires for agent changes too, so report each change through one of the two.

## Restore recorded state

Replay restores a checkpoint through the `vacp.apply_state` action. Register it inside `connectThreshold` with a function that validates the state and returns the change to apply:

```ts
import { registerVacpApplyStateAction } from '@ethivia/vacp-sdk';

registerVacpApplyStateAction(
  actions,
  (state) => {
    const next = thresholdParams.parse(state[ref]);
    return () => {
      input.value = String(next.value);
      return { applied: 1 };
    };
  },
  { affects: [ref] },
);
```

Agents can call `vacp.apply_state` too, so reject every state your actions refuse. Parsing with `thresholdParams` keeps a restored threshold between 0 and 100. A throw rejects the state before anything changes.

## Show presence targets

[Presence](../presence/) moves the agent's cursor to the entity an action's `.focus()` names. Mark the element that shows each ref with `data-vacp-ref`, and attach the provider with `createRefPresentation`, as [Point at your own controls](../presence/#point-at-your-own-controls) shows.

## Expose data with SQL

To let agents query rows, load them into DuckDB and register `vacp.data_sql` and `vacp.data_schema`. The DuckDB-Wasm client comes from `@ethivia/vacp-duckdb`, and the SQL handlers come from `@ethivia/vacp-sdk/data`. [DuckDB](https://duckdb.org) is an in-process SQL database, and DuckDB-Wasm runs it in the browser.

```bash
pnpm add @ethivia/vacp-duckdb @duckdb/duckdb-wasm@1.32.0
```

Inside `connectThreshold`, with `rows` as your data:

```ts
import {
  createDuckDbDataSchemaHandler,
  createDuckDbDataSqlHandler,
  registerVacpDataSchemaAction,
  registerVacpDataSqlAction,
} from '@ethivia/vacp-sdk/data';
import { createDuckDbWasmClient } from '@ethivia/vacp-duckdb';

const handleRef = 'vacp://example/scores';
const duckdb = createDuckDbWasmClient();
const loaded = duckdb.then((db) => db.loadObjectsAsTable('scores', rows));
const where = () => `score >= ${input.valueAsNumber}`;
async function forHandle<Handle>(ref: string, handle: Handle) {
  if (ref !== handleRef) return null;
  await loaded;
  return handle;
}

registerVacpDataSqlAction(
  actions,
  createDuckDbDataSqlHandler({
    duckdb,
    resolveHandle: (ref) =>
      forHandle(ref, { allSql: 'SELECT * FROM scores', selectedSql: `SELECT * FROM scores WHERE ${where()}` }),
  }),
  { inputRefs: [handleRef] },
);
registerVacpDataSchemaAction(
  actions,
  createDuckDbDataSchemaHandler({ duckdb, resolveHandle: (ref) => forHandle(ref, { table: 'scores' }) }),
  { inputRefs: [handleRef] },
);
```

Agents query `vacp_all` for every row and `vacp_handle` for the rows `selectedSql` returns. Add the handle to `project()`:

```ts
nodes: [{ ref: handleRef, kind: 'DataHandle', layer: 'DataLayer', title: 'Scores', data: { table: 'scores' } }],
state: { [handleRef]: { kind: 'DataHandle', rowCount: rows.length, selectionWhere: where() } },
```

The [data reference](../api/data) covers the registration functions, the handlers, and the handle fields.

## Release the integration

Call `dispose()` when the view unmounts. It detaches the installation's providers. When no providers remain, it disposes the runtime and removes `window.__vacp`. Call `dispose()` on the DuckDB client as well.

Next, [compose several sources](../composition/) or [declare availability](../availability/).
