# @ethivia/vacp-sdk

Author semantic actions with Zod schemas and stable refs with `createVacpActions` and `createVacpRefBuilder`.

```ts
import { createVacpProvider } from '@ethivia/vacp-runtime';
import { installVacpRuntime } from '@ethivia/vacp-browser';
import { createVacpActions } from '@ethivia/vacp-sdk';
import { z } from 'zod';

const actions = createVacpActions('vacp-source://example/threshold');
actions
  .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
  .params(z.object({ value: z.number().min(0).max(100) }))
  .handle(({ value }) => (input.value = String(value)));

const provider = createVacpProvider({ source, actions: actions.registry, project, subscribe });
const { runtime, dispose } = installVacpRuntime({
  providers: [provider],
  exposeBridge: true,
  injectDomSnapshot: false,
});
```

`createVacpActions(sourceId)` gives registered actions unique execution names for that source. Use `.contract(id)` to declare shared semantics, and execute the descriptor returned by `.handle()` using its `name`. Register standard actions on `actions.registry` with the `registerVacp*Action` functions of `@ethivia/vacp-runtime`.

`params(zodSchema)` derives the agent-facing input JSON Schema and validates parameters during preparation. Define parameters once, before `.focus()` or `.handle()`. Those callbacks receive the inferred Zod output type, including transforms and defaults. Async validation and Zod Mini are supported. Handlers also receive cancellation context.

Use `.requires(...refs)` to add node prerequisites. Describe current readiness alongside the projected state, as [availability](../../docs/availability/index.md) explains.

Follow the [custom integration guide](../../docs/integrate/index.md) for a tested example.
