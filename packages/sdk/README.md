# @ethivia/vacp-sdk

Lets AI agents read and change a visual analysis through named actions while the person watches. You define actions with [Zod](https://zod.dev) schemas, wrap each analytical source in a provider, and install the runtime, which publishes the page bridge at `window.__vacp`.

```bash
pnpm add @ethivia/vacp-sdk zod
```

This provider exposes one threshold value and an action that sets it:

```ts
import { createVacpActions, createVacpProvider, installVacpRuntime } from '@ethivia/vacp-sdk';
import { z } from 'zod';

let threshold = 50;
const ref = 'vacp://example/threshold';
const actions = createVacpActions();
actions
  .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
  .params(z.object({ value: z.number().min(0).max(100) }))
  .handle(({ value }) => (threshold = value));

const provider = createVacpProvider({
  source: { id: 'vacp-source://example/threshold', type: 'control', title: 'Threshold' },
  actions,
  project: () => ({
    graph: { nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer' }] },
    state: { [ref]: { value: threshold } },
  }),
  subscribe: () => () => {},
});
installVacpRuntime({ providers: [provider], exposeBridge: true });
```

| Entry                         | Exports                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@ethivia/vacp-sdk`           | Actions, providers, the runtime and page bridge, provenance, and protocol types                                            |
| `@ethivia/vacp-sdk/data`      | Data handles, and SQL over any DuckDB client                                                                               |
| `@ethivia/vacp-sdk/presence`  | Presence targets and the presence engine                                                                                   |
| `@ethivia/vacp-sdk/agent`     | Agent tools over a page bridge, and [WebMCP](https://webmachinelearning.github.io/webmcp/) registration for browser agents |
| `@ethivia/vacp-sdk/inspector` | Inspection sessions and clients                                                                                            |

Start with [Get started](https://docs.vacp.dev/get-started/) and [Custom provider](https://docs.vacp.dev/custom-provider/). The [API reference](https://docs.vacp.dev/api/) covers every entry.

## License

Apache-2.0
