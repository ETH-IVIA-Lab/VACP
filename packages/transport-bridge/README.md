# @ethivia/vacp-bridge

Map a VACP bridge to the five agent tools of the [tool contract](../../docs/api/agent-tools.md): `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_execute`, and `vacp_progress`.

```ts
import { createVacpTransport } from '@ethivia/vacp-bridge';

const transport = createVacpTransport(runtime);
const read = await transport.vacp_capabilities({ refs: ['vacp://'] });
await transport.vacp_execute(
  { name: 'threshold.set', params: { value: 42 }, narration: 'Raising the threshold.' },
  signal,
);
await transport.vacp_progress({ message: 'The view now shows values above 42.', done: true });
```

Each function takes the tool's input object as a model sent it. A bare `vacp://` entry is dropped from the scope, so alone it reads everything. An unscoped capabilities read leaves out node data unless `includeNodeData` is true. Every `vacp_state` answer carries a token. Graph reads leave out source ownership, and every answer is JSON cut to the limits of `vacpToolResult` from `@ethivia/vacp-protocol`.

`vacp_execute` trims the action name, gives a call without `call_id` a random one, and passes its `narration` and the transport's actor with the step. Its second argument is an `AbortSignal` the runtime forwards to the action handler. `vacp_progress` speaks through the bridge's `narrate()`, so a step and a sentence from the same actor share one turn. The actor defaults to `vacpAgentActor`. The transport depends on protocol types and on no model SDK. See [agent connections](../../docs/agents/index.md).
