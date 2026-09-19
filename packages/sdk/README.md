# @vacp/sdk

Connect application-owned analytical state to VACP with `createVacpActions`, `createVacpProvider`, and `installVacp`.

`createVacpProvider({ source, actions, project })` separates stable source metadata, semantic operations, and the current analytical projection. The projector returns the complete graph, including `actions: actions.registry.list()` or state-dependent action descriptions. The action binding only prepares execution. `installVacp({ providers })` attaches those sources to a composed browser runtime.

`createVacpActions(sourceId)` gives registered actions unique execution names for that source. Use `.contract(id)` to declare shared semantics, and execute the descriptor returned by `.handle()` using its `name`.

`params(zodSchema)` derives the agent-facing input JSON Schema and validates parameters during preparation. Define parameters once, before `.focus()` or `.handle()`. Those callbacks receive the inferred Zod output type, including transforms and defaults. Async validation and Zod Mini are supported. Handlers also receive cancellation context.

Use `.requires(...refs)` to add node prerequisites. Describe current readiness alongside the projected state; see [availability](../../docs/providers/availability.md).

Follow the [custom integration guide](../../docs/integrate/index.md) for a tested example.
