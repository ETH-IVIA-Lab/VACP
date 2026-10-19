# @ethivia/vacp-sdk

Defines operations for a custom provider with [Zod](https://zod.dev) schemas. Pair it with `createVacpProvider` from [`@ethivia/vacp-runtime`](./runtime#createvacpprovider). [Connect an application](../integrate/) walks through a complete provider.

## createVacpActions

```ts
createVacpActions(sourceId?: VacpSourceId): {
  registry: VacpActionRegistry;
  operation(kind: VacpOperationKind, name: string, description: string): VacpActionBuilder;
}
```

Returns a registry and a builder for its operations. Pass `registry` as the provider's `actions` and list its descriptors in the projection with `registry.list()`. With a `sourceId`, operation names are qualified by the source. Register standard operations on the same registry with `registerVacpApplyStateAction` and its siblings from `@ethivia/vacp-runtime`.

### Builder

`operation(kind, name, description)` starts an operation. Metadata methods return the builder:

| Method              | Effect on the descriptor                      |
| ------------------- | --------------------------------------------- |
| `title(text)`       | Sets `title`                                  |
| `contract(id)`      | Sets `operation.contract`                     |
| `requires(...refs)` | Adds prerequisites to `availability.requires` |
| `input(ref)`        | Adds to `operation.inputRefs`                 |
| `affects(ref)`      | Adds to `operation.affects`                   |
| `produces(result)`  | Adds to `operation.results`                   |

Then bind behavior:

| Method            | Effect                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `params(schema)`  | Sets `parameters` to the schema's JSON Schema (input mode) and parses every call with it. Call once, before `focus` and `handle` |
| `focus(resolve)`  | `resolve(params)` returns the `VacpFocus` presence points at, from the parsed parameters                                         |
| `handle(handler)` | Registers the operation and returns its descriptor. `handler(params, options)` applies the change                                |

`params` throws when called twice, after `focus`, or with a schema JSON Schema cannot represent, such as `z.date()` or `z.custom()`. Parsing runs during preparation, before any change, and applies defaults, coercion, transforms, refinements, and asynchronous checks. A failed parse produces a `VacpActionError` with `details: { code: 'invalid-params', issues }`, where each issue is `{ path, code, message }` and union failures carry `errors` per branch. Submitted values never appear in the issues.

`handler` receives the parsed parameters and the execution options, including `signal`, which aborts when the caller cancels or the provider is replaced. Its return value becomes the result's `result`.

```ts
const actions = createVacpActions();
actions
  .operation('query', 'search', 'Search records')
  .params(z.object({ text: z.string().min(1), limit: z.number().int().max(100).default(10) }))
  .handle(async ({ text, limit }, { signal }) => {
    const response = await fetch(`/search?q=${encodeURIComponent(text)}&limit=${limit}`, { signal });
    return response.json();
  });
```

## createVacpRefBuilder

```ts
createVacpRefBuilder(ids: { appId: string; viewId: string; vizId?: string }): {
  root: VacpRef;
  ref(suffix?: string): VacpRef;
}
```

Builds refs under one root. `createVacpRefBuilder({ appId: 'shop', viewId: 'orders' }).ref('selection/region')` is `vacp://shop/orders/selection/region`.
