# @vacp/sdk

Connect custom application state and controls to VACP with `createVacpActions`, `createVacpRefBuilder`, and `installVacp`.

`installVacp({ graph, actions, getState })` installs the browser runtime and returns its bridge, snapshot provider, refresh helper, and disposal function. Snapshot providers preserve application state, summary, and node metadata types. `params(description, parser)` infers handler parameters from a Zod schema or an application parser; without a parser, the handler owns input validation. Handlers accept domain-interface results. No schema generation is required.

Follow the [custom integration guide](../../docs/integrate/index.md) for a complete, tested example. Database handle routing lives in `@vacp/data-duckdb`.
