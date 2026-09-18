# Connect an analytical source

Use `@vacp/sdk` to describe a source, project its analytical state, and bind semantic operations to the application that owns the state.

The threshold example connects an HTML range input:

<<< ../../examples/custom-integration/threshold.ts

`createVacpProvider()` keeps three concerns explicit:

- `source` describes stable identity and provenance.
- `project()` returns the current analytical graph and state in one call.
- `actions` validates and invokes operations against the owning application.

`installVacp({ providers: [provider] })` attaches the provider to the browser runtime. Providers with distinct source IDs compose at the same global key. Installing a replacement with the same source ID changes that source while preserving the other providers.

## Describe operations

Every operation declares its semantic kind and relationships:

```ts
actions
  .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
  .affects('vacp://example/threshold')
  .params(
    {
      type: 'object',
      properties: { value: { type: 'number', minimum: 0, maximum: 100 } },
      required: ['value'],
    },
    thresholdParams,
  )
  .handle(({ value }) => setThreshold(value));
```

Use `mutation` for changes to live analytical state, `creation` for operations that create entities, `evaluation` for parameterized analyses, and `query` for reads that produce data. Add `.input(ref)`, `.affects(ref)`, and `.produces(result)` when those relationships are known.

Parameter descriptions remain JSON Schema-like objects owned by the application. VACP does not generate schemas from TypeScript types.

## Add semantic enrichment

Introspection can identify safe mechanical facts such as names, types, bounds, and synchronized values. Library and application adapters add analytical meaning such as selections, data handles, visualizations, and relationships between them.

Keep large datasets with their owning system. Expose a `DataHandle` and a query operation or bounded summary rather than embedding the dataset in the graph.

## Observe and release

`bridge.observe()` returns graph, state, source ownership, source revisions, and output freshness from one coherent read.

Call `integration.refresh(source, message)` after a human interaction when the provider does not publish invalidations. Call `integration.dispose()` when the source unmounts. Disposal removes the integration's source IDs and leaves unrelated providers attached.

See [provider composition](../providers/composition) and the [runtime reference](../reference/runtime).
