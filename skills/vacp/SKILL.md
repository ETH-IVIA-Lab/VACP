---
name: vacp
description: Add VACP to a web application so AI agents can read and change its charts and controls through named actions while the person watches each step. Use when adding AI-agent access, VACP, MCP tools, or an agent cursor or presence to a web app with charts, Vega-Lite, Mosaic or vgplot dashboards, or custom analytical controls.
license: Apache-2.0
metadata:
  version: '0.1.0'
---

# Add VACP to an application

VACP lets AI agents read and change a visual analysis through named actions. The application wraps each analytical source in a **provider**. A provider projects its source as a graph of nodes with stable **refs** such as `vacp://sales/filters/threshold`, the state of those nodes, and the **actions** an agent can execute. The **runtime** composes the providers. `installVacpRuntime` publishes the runtime in the page as the **page bridge** at `window.__vacp`. Work through the sections in order, and finish with the browser check before you report success.

## Inspect the app and pick the path

Read `package.json`. Find where each chart mounts and which function each control calls to change app state.

| The app renders                                                    | Use                                                         | Read                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Vega-Lite specs through `vega-embed`                               | `createVegaLiteProvider`                                    | [references/vega-lite.md](references/vega-lite.md)             |
| Mosaic vgplot plots through `@uwdata/vgplot`                       | `createVgplotProvider`                                      | [references/vgplot.md](references/vgplot.md)                   |
| Other charts (D3, ECharts, Plotly, canvas), forms, filters, stores | `createVacpProvider`                                        | [references/custom-provider.md](references/custom-provider.md) |
| Several of these                                                   | One provider per source, all passed to `installVacpRuntime` | Each file above                                                |

Then settle two more facts:

- **Framework.** Read [references/frameworks.md](references/frameworks.md) when charts mount inside React, Vue, Svelte, or another component lifecycle.
- **DuckDB.** Read [references/data.md](references/data.md) when agents must query rows with SQL, and when the page already runs [DuckDB](https://duckdb.org), the in-process SQL database.

Put the integration in one module, such as `src/vacp.ts`. The app stays an ordinary analytical app that calls this module once.

## Install the packages

Use the package manager the app already uses. `npm install` and `yarn add` take the same names.

```bash
pnpm add @ethivia/vacp-sdk zod                     # always
pnpm add @ethivia/vacp-vega vega vega-lite vega-embed  # Vega-Lite
pnpm add @ethivia/vacp-vgplot @uwdata/vgplot @uwdata/mosaic-core @uwdata/mosaic-inputs @uwdata/mosaic-plot @uwdata/mosaic-sql  # vgplot
```

[Zod](https://zod.dev) is the schema library that declares action parameters. The packages need Zod `^4.6.7`, Vega `^6.4.0`, Vega-Lite `^6.5.0`, and Mosaic `0.35.0` or later. If the app pins an older major version of a library, ask the person before you upgrade it.

## Write the smallest integration

This custom provider connects one range input. `setThreshold` stands for the function the app's own input handler calls.

```ts
import { createVacpActions, createVacpProvider, installVacpRuntime, vacpHumanActor } from '@ethivia/vacp-sdk';
import { z } from 'zod';

export function connectThreshold(input: HTMLInputElement, setThreshold: (value: number) => void) {
  const ref = 'vacp://sales/filters/threshold';
  const actions = createVacpActions();

  actions
    .operation('mutation', 'threshold.set', 'Set the minimum revenue, in thousands of dollars, from 0 to 100')
    .affects(ref)
    .params(z.object({ value: z.number().finite().min(0).max(100) }))
    .focus(() => ({ ref }))
    .handle(({ value }) => {
      setThreshold(value);
      return { value: input.valueAsNumber };
    });

  const provider = createVacpProvider({
    source: { id: 'vacp-source://sales/filters', type: 'control', title: 'Filters' },
    actions,
    project: () => ({
      graph: {
        nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer', title: 'Minimum revenue' }],
      },
      state: { [ref]: { value: input.valueAsNumber } },
    }),
  });

  const { runtime, dispose } = installVacpRuntime({
    providers: [provider],
    exposeBridge: true,
  });
  void runtime.record({ message: 'Initial filters' });

  const onChange = () => void runtime.record({ actor: vacpHumanActor, message: `Set the minimum to ${input.value}` });
  input.addEventListener('change', onChange);

  return () => {
    input.removeEventListener('change', onChange);
    dispose();
  };
}
```

## Follow these rules

1. **Create one provider per analytical source.** Give it one `source.id`. Two providers that claim the same ref or action name make `observe()` fail with an error that names both owners.
2. **Keep refs and source IDs stable across reloads.** Build them from domain names, with `createVacpRefBuilder` or by hand. Array indexes and generated IDs break replay and every agent prompt that names a ref.
3. **Validate every action with Zod.** Call `.params(schema)` before `.focus()` and `.handle()`. The runtime parses each call before the handler runs and sends agents the schema as JSON Schema. State units and ranges in the description. For a domain failure, throw `new VacpActionError(message, details)`, and the agent receives `details` unchanged.
4. **Call the app's own update function from the handler.** Setting a DOM value alone leaves the chart stale. Dispatching a synthetic event runs the person's listeners and records the agent's step as the person's. Return values read back from the source.
5. **Pass `exposeBridge` explicitly.** The application decides whether the page bridge is public. Set `exposeBridge: true` for builds an external agent drives, because every script in the page can then call every action. `injectDomSnapshot: true` also writes each observation into script tags for agents that read the DOM.
6. **Read configuration in the application only.** A provider module takes its elements, stores, and options as arguments. It reads no `window` state, URL flags, environment variables, or browser storage to decide what it exposes.
7. **Attribute the person's changes.** Call `runtime.record({ actor: vacpHumanActor, message })` when a gesture ends, in a `change` or `pointerup` handler. Use `subscribe()` only for changes nobody attributes, such as a timer or a data reload: it records them as `system`, and it fires for agent changes too. A change reported through both appears twice. Call `runtime.record()` once at startup to record the baseline.
8. **Read live values in `project()`.** Return the current state on every call. A cached projection tells agents the old state.
9. **Write narration for the person watching.** Each step gets its own sentence of at most 280 characters that says what changes and why, such as "Keeping regions above the median to compare them." Leave out tool names, refs, IDs, and remarks about the agent.
10. **Release on unmount.** Call `dispose()`, and detach the listeners you added. A remount that skips this keeps stale listeners attached.

## Verify in a real browser

Start the dev server and open the page in a real browser, through Playwright, a browser tool, or the developer console. Run these calls with one of your own actions:

```js
const { graph, state } = await window.__vacp.observe();
console.log(
  graph.nodes.map((node) => node.ref),
  graph.actions.map((action) => action.name),
  state,
);

await window.__vacp.execute(
  { name: 'threshold.set', params: { value: 80 } },
  { narration: 'Raising the minimum to 80 to focus on the largest accounts.' },
);
await window.__vacp.execute({ name: 'threshold.set', params: { value: 150 } });
```

The page bridge accepts a call without narration, as the second call shows. MCP and WebMCP require one.

1. `graph.nodes` lists every chart and control you connected, and `state` matches what the screen shows.
2. The first `execute` returns `ok: true`. Confirm the change on the page by reading the control's value, the chart's marks, or a screenshot. An `ok: true` result proves the handler returned and says nothing about the screen.
3. The second `execute` returns `ok: false` with `error.details.code` set to `invalid-params`, and the page stays as it was.
4. Change a control with real mouse or keyboard input, then run `window.__vacp.getProvenance().records.findLast((record) => record.kind === 'observation')`. The record's `actor.kind` is `human`. A `turn` record can follow agent steps, so read the observation by kind.
5. Reload the page and run `observe()` again. Every ref and source ID matches the first read.

Chart providers give actions qualified names such as `source_ab12.vega_lite.set_selection`. Find one with `graph.actions.find((action) => action.operation.contract === 'vega_lite.set_selection')`, then call its `name`.

## Connect an agent

An agent reaches the page in one of three ways. [references/agents.md](references/agents.md) has the options, the five agent tools, and the setup for each.

| The agent runs in                                   | Connect with                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| An MCP client such as Claude Code, Codex, or Cursor | The `vacp` Python package, run with `uvx`, with `exposeBridge: true` on the page                                                 |
| The page, with a model call you control             | `createVacpToolLoopAgent` from `@ethivia/vacp-ai`, built on the [AI SDK](https://ai-sdk.dev)                                     |
| A browser with `document.modelContext`              | `installVacpWebMcp` from `@ethivia/vacp-sdk/agent`, which registers [WebMCP](https://webmachinelearning.github.io/webmcp/) tools |

[MCP](https://modelcontextprotocol.io) is the protocol agent clients use to call external tools. With the dev server running, register the server with Claude Code:

```bash
uvx --from 'vacp[server]' playwright install chromium
claude mcp add vacp -- uvx --from 'vacp[server]' vacp --url http://localhost:5173/
```

Ask the agent to change something, and confirm the page changes. Read [references/presence.md](references/presence.md) when the person should see an agent cursor and a sentence for each step, or step back through the agent's work. The docs at <https://docs.vacp.dev/llms.txt> link a Markdown copy of every page.
