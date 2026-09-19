# Connect an analytical source

Use `@vacp/sdk` to describe a source, project its analytical state, and bind semantic operations to the application that owns the state.

The threshold example connects an HTML range input:

<<< ../../examples/custom-integration/threshold.ts

`createVacpProvider()` keeps three concerns explicit:

- `source` describes stable identity and provenance.
- `project()` returns the complete analytical graph and state in one call. Include `actions: actions.registry.list()` in the graph, or project current action descriptions from the same state.
- `actions` validates and invokes operations against the owning application.

`installVacp({ providers: [provider] })` attaches the provider to the browser runtime. Providers with distinct source IDs compose at the same global key. Installing a replacement with the same source ID changes that source while preserving the other providers.

## Describe operations

Every operation declares its semantic kind and relationships:

```ts
import { z } from 'zod';

actions
  .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
  .affects('vacp://example/threshold')
  .params(z.object({ value: z.number().min(0).max(100) }))
  .handle(({ value }) => setThreshold(value));
```

Use `mutation` for changes to live analytical state, `creation` for operations that create entities, `evaluation` for parameterized analyses, and `query` for reads that produce data. Add `.input(ref)`, `.affects(ref)`, and `.produces(result)` when those relationships are known.

Define `.params(zodSchema)` before `.focus()` or `.handle()`. VACP converts the schema to JSON Schema once when defining the action, using Zod's input mode. Agents receive that input description. Callbacks receive the inferred, parsed output. Defaults, coercion, transforms, and async validation run during preparation, before the handler can change application state.

Use `.describe()` and `.meta()` on Zod schemas to add parameter descriptions, examples, and domain metadata. Both Zod 4 and Zod Mini schemas are supported. JSON Schema describes the serializable input structure. Refinements and application-specific checks still run in Zod. Coercion may accept additional values beyond the generated input description.

Inputs that Zod cannot represent as JSON Schema, such as `z.date()` or `z.custom()`, throw when defining the action. Describe a JSON input and transform it to the domain value instead, for example `z.iso.datetime().transform(value => new Date(value))`. Recursive schemas retain local `$ref` references. Use `.default({})` on an empty object schema when an action accepts omitted parameters.

### Report invalid parameters

Invalid parameters fail before the handler runs. The action result includes `error.details.code: 'invalid-params'` and `error.details.issues`, an array of `{ path, code, message }` records. Paths preserve field names and array indices, so agents and custom UIs can identify the input to correct without parsing an error message. Zod's issue codes and configured messages are preserved. Submitted values are not copied into these records.

Union failures retain each branch's diagnostics in `errors`. Invalid keys and elements retain their nested `issues`, using the same record shape recursively.

Exceptions thrown by application transforms or refinements remain application errors. To supply structured domain diagnostics, throw `new VacpActionError(message, details)` from `@vacp/protocol`. Its serializable `details` reach the action result unchanged.

## Support state restoration

Prepare restoration by parsing desired state and returning a mutation closure. Validation runs before execution and optional presentation pacing:

```ts
import { createVacpActions } from '@vacp/sdk';
import { z } from 'zod';

const actions = createVacpActions();
const ref = 'vacp://example/threshold';
const threshold = z.number().min(0).max(100);
let value = 50;

actions.standard.applyState(
  (state) => {
    const next = threshold.parse(state[ref]);
    return () => {
      value = next;
      return { applied: 1 };
    };
  },
  { affects: [ref] },
);
```

Expose the same value through the provider's `project()` function. Consumers explicitly apply recorded state using the [runtime restorer](../reference/runtime#history-and-explicit-restoration).

## Add semantic enrichment

Introspection can identify safe mechanical facts such as names, types, bounds, and synchronized values. Library and application adapters add analytical meaning such as selections, data handles, visualizations, and relationships between them.

Keep large datasets with their owning system. Expose a `DataHandle` and a query operation or bounded summary rather than embedding the dataset in the graph.

## Observe and release

`bridge.observe()` returns graph, state, source ownership, source revisions, and output freshness from one coherent read.

Call `integration.refresh(source, message)` after a human interaction when the provider does not publish invalidations. Call `integration.dispose()` when the source unmounts. Disposal removes the integration's source IDs and leaves unrelated providers attached.

Add [agent presence](../presence/) to show operation focus on your own surface.

See [provider composition](../providers/composition) and the [runtime reference](../reference/runtime).
