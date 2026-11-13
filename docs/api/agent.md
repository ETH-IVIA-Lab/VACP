# @ethivia/vacp-sdk/agent

These exports connect an agent to a page: the five [agent tools](./agent-tools) over a page bridge, and registration of the same page as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools. WebMCP is a proposed browser API, `document.modelContext`, through which a page offers tools to agents that run in the browser.

```ts
import {
  compileVacpWebMcpTools,
  createVacpToolHandlers,
  getVacpBridge,
  installVacpWebMcp,
  parseVacpNarration,
  VACP_NARRATION_MAX_LENGTH,
  VACP_SCHEMA_VERSION,
  vacpAgentToolGuidance,
  vacpAgentTools,
  vacpNarrationGuidance,
  vacpProgressFields,
  vacpToolResult,
  type VacpAgentActivityControl,
  type VacpCapabilitiesRequest,
  type VacpExecuteInput,
  type VacpProgressInput,
  type VacpStateRequest,
  type VacpToolBridge,
  type VacpToolHandlers,
  type VacpToolResult,
  type VacpWebMcpInstallation,
  type VacpWebMcpOptions,
  type VacpWebMcpRegistry,
} from '@ethivia/vacp-sdk/agent';
```

## createVacpToolHandlers

```ts
function createVacpToolHandlers(bridge: VacpToolBridge, options?: { actor?: VacpActor }): VacpToolHandlers;
// VacpToolBridge: Pick<VacpPageBridge, 'version' | 'observe' | 'getCapabilities' | 'getState' | 'execute' | 'narrate'>
```

Maps the agent tools onto a [page bridge](./runtime#vacppagebridge) or a runtime.

- `options.actor`: the actor of every execution and sentence. Default: [`vacpAgentActor`](./runtime#actors).

Returns a [`VacpToolHandlers`](#vacptoolhandlers).

```ts
import { createVacpToolHandlers, getVacpBridge } from '@ethivia/vacp-sdk/agent';

const bridge = getVacpBridge();
if (!bridge) throw new Error('No VACP runtime in this page');
const tools = createVacpToolHandlers(bridge);
const { token } = (await tools.vacp_state()) as { token: string };
```

## getVacpBridge

```ts
function getVacpBridge(options?: { globalKey?: string }): VacpPageBridge | undefined;
```

Returns the [`VacpPageBridge`](./runtime#vacppagebridge) at `window[globalKey]`, `'__vacp'` by default. Returns `undefined` when nothing is installed, the bridge's `version` differs from this package's, or a required member is missing.

## VacpToolHandlers

```ts
interface VacpToolHandlers {
  vacp_observe(input?: Record<string, never>): Promise<VacpToolResult>;
  vacp_capabilities(input?: VacpCapabilitiesRequest): Promise<VacpToolResult>;
  vacp_state(input?: VacpStateRequest): Promise<VacpToolResult>;
  vacp_execute(input: VacpExecuteInput, signal?: AbortSignal): Promise<VacpToolResult>;
  vacp_progress(input: VacpProgressInput, signal?: AbortSignal): Promise<VacpToolResult>;
}
```

Each function takes a tool's input as the model sent it and returns the JSON the model reads, cut to the [result bounds](./agent-tools#result-bounds). Graph reads leave out source ownership.

- `vacp_execute` passes `callId` as the call's ID, and the runtime assigns one when it is absent, null, or blank. Aborting `signal` cancels the step. Throws a `TypeError` for an empty `name` or an unusable `narration`.
- `vacp_progress` speaks through `bridge.narrate` and returns `{ ok: true }`. Aborting `signal` cancels a turn this call opens. Throws a `TypeError` for an unusable `message`.

## VacpExecuteInput

```ts
type VacpExecuteInput = { name: string; params?: unknown; narration: string; callId?: string | null };
```

The input of `vacp_execute`, described in [Agent tools](./agent-tools#vacp-execute). `callId` is the host's ID for the call, such as the model API's tool call ID. The model never fills it, and the tool schemas leave it out.

## VacpProgressInput

```ts
type VacpProgressInput = { message: string; done?: boolean };
```

The input of `vacp_progress`, described in [Agent tools](./agent-tools#vacp-progress).

## VacpCapabilitiesRequest

```ts
type VacpCapabilitiesRequest = {
  refs?: VacpRef[];
  prefixes?: VacpRef[];
  kinds?: VacpNodeKind[];
  layers?: VacpLayer[];
  includeActions?: boolean;
  includeEdges?: boolean;
  includeNodeData?: boolean;
};
```

Scopes a graph read.

- `refs`: includes these nodes.
- `prefixes`: includes the nodes whose ref starts with one of these.
- `kinds`, `layers`: filter the nodes by kind and layer.
- `includeActions`: includes action descriptors. Default: `true`.
- `includeEdges`: includes the edges whose two ends remain. Default: `true`.
- `includeNodeData`: includes each node's `data`. Default: `true`.

## VacpStateRequest

```ts
type VacpStateRequest = { since?: string; refs?: VacpRef[]; includeSummary?: boolean };
```

Scopes a state read.

- `since`: the `token` of an earlier read. Default: a full read.
- `refs`: includes these refs. Default: every ref.
- `includeSummary`: includes per-ref summaries. Default: `true`.

## VacpToolResult

```ts
type VacpToolResult = string | number | boolean | null | VacpToolResult[] | { [key: string]: VacpToolResult };
```

A JSON value, as a tool returns it to a model.

## vacpToolResult

```ts
function vacpToolResult(
  value: unknown,
  limits?: { depth: number; items: number; keys: number; characters: number },
): VacpToolResult;
```

Returns `value` as JSON cut to `limits`, with markers that say what was cut. Dates, errors, maps, sets, typed arrays, and `toJSON` values read as the JSON they stand for, and a value inside itself reads as `[circular]`.

- `limits`: how much of the value to keep. Default: the [result bounds](./agent-tools#result-bounds). Pass all four fields to change them.

## installVacpWebMcp

```ts
function installVacpWebMcp(runtime: Source, options?: VacpWebMcpOptions): Promise<VacpWebMcpInstallation | undefined>;
// Source: Pick<VacpRuntime, 'observe' | 'getCapabilities' | 'getState' | 'execute' | 'narrate' | 'subscribeCapabilities' | 'signal'>
```

Registers the runtime's currently available actions as WebMCP tools and follows its capability changes. The [WebMCP guide](../agents/webmcp) shows the tools an agent sees.

Resolves once the first registration completes, to a [`VacpWebMcpInstallation`](#vacpwebmcpinstallation). Resolves to `undefined` when `options.context` is absent and the document has no `document.modelContext`.

Rejects when the first graph read fails, and with `WebMCP registration failed for <tool>` when the first registration fails, with the browser's error as the `cause`. Disposing the runtime disposes the installation.

### Tool names

Every tool name matches `[A-Za-z0-9_-]{1,64}`, the tool names model APIs accept, so a browser agent hands the catalog to a model as registered.

- `<namespace>_observe`, `<namespace>_capabilities`, and `<namespace>_state` read the page. `capabilities` takes the fields of `VacpCapabilitiesRequest` except `includeActions`. Their graphs leave out actions, because each action is its own tool.
- `<namespace>_progress` takes the fields of `VacpProgressInput`.
- `<namespace>_<name>` runs one available action, with each `.` in its name as `_`: `vacp_threshold_set` runs `threshold.set`. A name longer than 64 characters keeps its first 55 and ends with `_` and 8 hexadecimal digits of a hash of the whole name.

The tools carry the titles of [`vacpAgentTools`](#vacpagenttools). `<namespace>_state` and `<namespace>_progress` carry its descriptions, and the graph reads describe each action as its own tool.

### Action tool input

Every action tool requires `narration`, the step's sentence. A call with an unusable `narration` returns `{ ok: false, error: { message } }` and runs nothing.

The tool's other fields depend on the action's `parameters`:

- An action without `parameters` takes `{ narration }`.
- An object schema takes its own properties beside `narration`. The schema can hold `type`, `properties`, `required`, `title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`, `$schema`, `$id`, `$anchor`, `$dynamicAnchor`, `$defs`, and `definitions`.
- Any other schema takes `{ params, narration }`, with the action's schema under `params`. That covers a scalar schema, a schema with other keys such as `additionalProperties` or `oneOf`, a schema with `$ref` or `$dynamicRef`, and a schema with its own `narration`.

## VacpWebMcpOptions

```ts
type VacpWebMcpOptions = {
  actor?: VacpActor;
  namespace?: string;
  onError?: (cause: unknown) => void;
  signal?: AbortSignal;
  context?: VacpWebMcpRegistry;
};
```

- `actor`: the actor of every step and sentence. Default: [`vacpAgentActor`](./runtime#actors).
- `namespace`: the prefix of every tool name, joined by `_`. At most 51 characters of `[A-Za-z0-9_-]`. Default: `'vacp'`.
- `onError`: receives a failed registration after a capability change. Default: none.
- `signal`: removes the tools when aborted. Default: none.
- `context`: the registry to install into. Default: `document.modelContext`.

## VacpWebMcpRegistry

```ts
type VacpWebMcpRegistry = {
  registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions): Promise<void>;
};
```

The part of `document.modelContext` the installation uses. The `WebMCP` types describe the browser API.

## VacpWebMcpInstallation

```ts
type VacpWebMcpInstallation = {
  refresh(): Promise<void>;
  readonly error: unknown;
  readonly toolNames: readonly string[];
  dispose(): void;
};
```

- `refresh()`: reads the graph and resolves once it, or a later graph, is registered. Rejects when registration fails.
- `error`: the last failed automatic registration. A successful refresh clears it. A failed registration removes this installation's tools until the next one succeeds.
- `toolNames`: the registered tool names.
- `dispose()`: removes this installation's tools and leaves the runtime running.

## compileVacpWebMcpTools

```ts
function compileVacpWebMcpTools(
  graph: VacpGraph,
  client: Pick<VacpPageBridge, 'observe' | 'getCapabilities' | 'getState' | 'execute'>,
  options?: { actor?: VacpActor; namespace?: string },
): WebMCP.ModelContextTool[];
```

Compiles one graph into tool definitions without registering them: the three read tools and one tool per available action. `installVacpWebMcp` adds the progress tool.

- `options.actor`: the actor of every step. Default: [`vacpAgentActor`](./runtime#actors).
- `options.namespace`: the prefix of every tool name, joined by `_`. Default: `'vacp'`.

Throws a `TypeError` for a tool name outside `[A-Za-z0-9_-]{1,64}`, a duplicate tool name such as the tools of `a.b` and `a_b`, an empty description, or `parameters` that are not a JSON Schema object. Throws an `Error` when the graph's availability names a missing prerequisite or forms a cycle.

## VacpAgentActivityControl

```ts
interface VacpAgentActivityControl {
  beginAgentActivity(options: { actor: VacpActor; summary?: string; signal?: AbortSignal }): VacpAgentActivityHandle;
  narrate(input: { actor: VacpActor; message: string; done?: boolean; signal?: AbortSignal }): void;
}
```

Publishes an agent's public progress as turns. A page bridge and a runtime implement it. [Agent activity](./runtime#agent-activity) gives the rules for each function.

## vacpAgentTools

```ts
const vacpAgentTools: Record<
  ToolName,
  { title: string; description: string; input: readonly string[]; readOnly: boolean }
>;
// ToolName: 'vacp_observe' | 'vacp_capabilities' | 'vacp_state' | 'vacp_execute' | 'vacp_progress'
```

Each tool's title, description, camelCase input field names, and whether it only reads, for a host that registers the tools with its own model library. `readOnly` is MCP's `readOnlyHint` annotation.

## vacpAgentToolGuidance

```ts
const vacpAgentToolGuidance: string;
```

The instructions on using the tools economically. Add them to the instructions of your own model loop.

## vacpNarrationGuidance

```ts
const vacpNarrationGuidance: string;
```

The description of the `narration` field on every action tool.

## vacpProgressFields

```ts
const vacpProgressFields: { message: string; done: string };
```

The descriptions of the two fields of the progress tool. The tool's own description is `vacpAgentTools.vacp_progress.description`.

## parseVacpNarration

```ts
function parseVacpNarration(value: unknown, field?: string): string;
```

Returns the sentence with Unicode White_Space trimmed from both ends. Throws a `TypeError` that names `field`, `'narration'` by default, when `value` is not a string, is blank, or is longer than `VACP_NARRATION_MAX_LENGTH`.

## VACP_NARRATION_MAX_LENGTH

```ts
const VACP_NARRATION_MAX_LENGTH: 280;
```

The longest sentence an agent can show, in Unicode code points.

## VACP_SCHEMA_VERSION

```ts
const VACP_SCHEMA_VERSION: '0.1.0';
```

The `version` of every observation, capabilities snapshot, and state update.
