# Get started

In this tutorial you build a web page with one slider and make the slider operable by AI agents. You run an agent's calls yourself in the browser console, then connect a real agent through MCP. It takes about ten minutes.

You need [Node.js](https://nodejs.org) 20.19 or newer and [pnpm](https://pnpm.io/installation).

## Create the app

Create a [Vite](https://vite.dev) app from its vanilla TypeScript template. Vite is a dev server and bundler for web pages. Then add VACP and [Zod](https://zod.dev), the schema library that declares an action's parameters:

```bash
pnpm create vite@latest my-app --template vanilla-ts
cd my-app
pnpm install
pnpm add @ethivia/vacp-sdk zod
```

pnpm lists `@ethivia/vacp-sdk` and `zod` under `dependencies:` when it finishes.

## Add the slider

In `index.html`, replace `<div id="app"></div>` with a range input:

```html
<label>Threshold <input id="threshold" type="range" min="0" max="100" value="50" /></label>
```

## Connect the slider to VACP

Replace the contents of `src/main.ts` with this code:

```ts
import { createVacpActions, createVacpProvider, installVacpRuntime, vacpHumanActor } from '@ethivia/vacp-sdk';
import { z } from 'zod';

const input = document.querySelector<HTMLInputElement>('#threshold')!;
const ref = 'vacp://my-app/threshold';

const actions = createVacpActions();
actions
  .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
  .affects(ref)
  .params(z.object({ value: z.number().min(0).max(100) }))
  .handle(({ value }) => {
    input.value = String(value);
    return { value: input.valueAsNumber };
  });

const provider = createVacpProvider({
  source: { id: 'vacp-source://my-app/threshold', type: 'control', title: 'Threshold control' },
  actions,
  project: () => ({
    graph: {
      nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer', title: 'Threshold' }],
    },
    state: { [ref]: { value: input.valueAsNumber } },
  }),
});

const { runtime } = installVacpRuntime({ providers: [provider], exposeBridge: true });

input.addEventListener('change', () => {
  void runtime.record({ actor: vacpHumanActor, message: 'Threshold changed' });
});
```

The code has four parts:

1. `createVacpActions()` creates a registry of actions, and `.operation(kind, name, description)` defines one action on it. The kind `mutation` marks an action that changes the page. The action `threshold.set` takes a `value` from 0 to 100, checked by its Zod schema, and its handler moves the slider.
2. `createVacpProvider()` describes the slider to VACP. `project()` returns one `Param` node with the ref `vacp://my-app/threshold` and the slider's value. VACP adds the actions from `actions`.
3. `installVacpRuntime()` puts the provider in a runtime and publishes the runtime at `window.__vacp`.
4. The `change` listener reports each finished drag to the runtime, attributed to the person, which records it in [provenance](../concepts/#provenance).

[Core concepts](../concepts/) defines provider, runtime, node, and ref.

Start the dev server:

```bash
pnpm dev
```

Vite prints `Local: http://localhost:5173/`. Open that URL. The page shows the slider at 50.

## Read the page as an agent does

Open the browser's developer console on the page and run:

```js
await window.__vacp.observe();
```

The console shows one observation of the page:

```js
{
  version: '0.1.0',
  revision: 'obs_9a0f532451f0937b',
  observedAt: '2026-11-08T19:53:38.193Z',
  graph: {
    sources: [{ id: 'vacp-source://my-app/threshold', type: 'control', title: 'Threshold control' }],
    ownership: {
      nodes: { 'vacp://my-app/threshold': 'vacp-source://my-app/threshold' },
      actions: { 'threshold.set': 'vacp-source://my-app/threshold' },
    },
    nodes: [{ ref: 'vacp://my-app/threshold', kind: 'Param', layer: 'ConfigLayer', title: 'Threshold' }],
    edges: [],
    actions: [
      {
        name: 'threshold.set',
        description: 'Set the threshold between 0 and 100',
        operation: { kind: 'mutation', affects: ['vacp://my-app/threshold'] },
        parameters: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: { value: { type: 'number', minimum: 0, maximum: 100 } },
          required: ['value'],
        },
      },
    ],
  },
  state: { 'vacp://my-app/threshold': { value: 50 } },
}
```

`graph.nodes` lists the slider. `graph.actions` lists `threshold.set` with its parameters as [JSON Schema](https://json-schema.org). `state` holds the slider's value. An agent reads the same object. Your `observedAt` is the time of your read.

## Move the slider through the action

Run the action from the console:

```js
await window.__vacp.execute({ name: 'threshold.set', params: { value: 80 } });
```

The slider jumps to 80, and the call returns:

```js
{ callId: '2e99874a-052c-4298-94fd-61b9ca40a243', ok: true, result: { value: 80 } }
```

Every call gets its own `callId`. `execute` runs as the agent unless you pass another actor. Next, send a value the schema rejects:

```js
await window.__vacp.execute({ name: 'threshold.set', params: { value: 150 } });
```

The slider stays at 80. VACP checks the parameters before the handler runs, and the result names the failed check:

```js
{
  callId: '462b65be-88e1-4326-917f-f2f2bdc8da92',
  ok: false,
  error: {
    message: 'Invalid parameters for action "threshold.set"',
    details: {
      code: 'invalid-params',
      issues: [{ path: ['value'], code: 'too_big', message: 'Too big: expected number to be <=100' }],
    },
  },
}
```

## See who changed what

Drag the slider with the mouse, then run:

```js
window.__vacp.getProvenance().records.map((record) => `${record.kind} by ${record.actor.id}`);
```

```js
['action by agent', 'action by agent', 'observation by human'];
```

The two `action` records are your two `execute` calls, including the rejected one. The `observation` record is your drag. The list can also hold a `turn` record, which closes the agent's run of steps. [Provenance and replay](../provenance/) builds checkpoints and replay from these records.

## Let an agent move the slider

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) is the protocol agent clients such as Claude Code, Codex, and Cursor use to call external tools. The `vacp` Python package runs an MCP server. The server opens your page in a Chromium window and gives the agent the VACP tools over the page's runtime. You run it with `uvx` from [uv](https://docs.astral.sh/uv/getting-started/installation/), the Python package manager. `uvx` runs a Python command without adding it to a project.

Keep `pnpm dev` running. Install Chromium for the server once:

```bash
uvx --from 'vacp[server]' playwright install chromium
```

Register the server with Claude Code, pointed at your dev URL:

```bash
claude mcp add vacp -- uvx --from 'vacp[server]' vacp --url http://localhost:5173/
```

Other MCP clients take the same command in their server settings. Start Claude Code and ask "Set the threshold to 25." The agent calls `vacp_execute` with the name `threshold.set` and the params `{ "value": 25 }`. The tool returns `{ "ok": true, "result": { "value": 25 } }`, and the slider in the Chromium window moves to 25. [Connect an agent](../agents/) lists the server's options.

## Build with a coding agent

Install the VACP agent skill so a coding agent can add VACP to your app. The [`skills` CLI](https://github.com/vercel-labs/skills) installs it for Claude Code, Cursor, Codex, and other agents:

```bash
npx skills add https://github.com/ETH-IVIA-Lab/VACP --skill vacp
```

Point the agent at [`llms.txt`](https://docs.vacp.dev/llms.txt), which links a Markdown copy of every page of these docs.

## Next steps

- Read [core concepts](../concepts/) for the model behind observations and actions.
- Add VACP to a [Vega-Lite](../vega-lite/) or [Mosaic vgplot](../vgplot/) chart.
