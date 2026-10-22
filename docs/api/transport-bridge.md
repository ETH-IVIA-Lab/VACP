# @ethivia/vacp-bridge

Maps the five [agent tools](./agent-tools) onto a page bridge, independent of any model library.

## createVacpTransport

```ts
createVacpTransport(bridge: VacpWindowBridge & Pick<VacpAgentActivityControl, 'narrate'>, options?: { actor?: VacpActor }): VacpTransport
```

```ts
interface VacpTransport {
  vacp_observe(input?: {}): Promise<VacpToolResult>;
  vacp_capabilities(input?: VacpCapabilitiesRequest): Promise<VacpToolResult>;
  vacp_state(input?: VacpStateRequest): Promise<VacpToolResult>;
  vacp_execute(
    input: { name: string; params?: unknown; narration: string; call_id?: string | null },
    signal?: AbortSignal,
  ): Promise<VacpToolResult>;
  vacp_progress(input: { message: string; done?: boolean }, signal?: AbortSignal): Promise<VacpToolResult>;
}
```

Each function takes the tool's input as the model sent it and returns the bounded JSON the model reads. Graph reads leave out source ownership. Every execution and sentence is attributed to `options.actor`, `vacpAgentActor` by default.

`vacp_execute` passes `call_id` as the call's `callId`, and the runtime assigns one when it is absent, null, or blank. `vacp_execute` throws a `TypeError` for an empty `name` or an unusable `narration`. Aborting `signal` cancels the step. `vacp_progress` speaks through `bridge.narrate` and returns `{ ok: true }`. It throws a `TypeError` for an unusable `message`.

```ts
import { getVacpBridge } from '@ethivia/vacp-browser';
import { createVacpTransport } from '@ethivia/vacp-bridge';

const transport = createVacpTransport(getVacpBridge()!);
const { token } = (await transport.vacp_state()) as { token: string };
```
