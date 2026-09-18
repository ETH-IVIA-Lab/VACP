# @vacp/sdk

Connect application-owned analytical state to VACP with `createVacpActions`, `createVacpProvider`, and `installVacp`.

`createVacpProvider({ source, actions, project })` separates stable source metadata, semantic operations, and the current analytical projection. `installVacp({ providers })` attaches those sources to a composed browser runtime.

`createVacpActions(sourceId)` gives registered actions unique execution names for that source. Use `.contract(id)` to declare shared semantics, and execute the descriptor returned by `.handle()` using its `name`.

`params(description, parser)` accepts a Zod schema or an application parser. Handlers receive validated parameters plus cancellation context. VACP does not generate schemas from TypeScript types.

Follow the [custom integration guide](../../docs/integrate/index.md) for a tested example.
