# @ethivia/vacp-webmcp

Registers VACP operations as [WebMCP](https://webmachinelearning.github.io/webmcp/) tools. The [WebMCP guide](../agents/webmcp) explains the tools agents see.

## installVacpWebMcp

```ts
installVacpWebMcp(runtime: VacpWebMcpSource, options?: {
  actor?: VacpActor;
  namespace?: string;
  onError?: (cause: unknown) => void;
  signal?: AbortSignal;
  context?: VacpWebMcpRegistry;
}): Promise<VacpWebMcpInstallation | undefined>
```

Registers the runtime's available operations and follows its capability changes. Resolves to `undefined` when `context` is absent and the document has no `document.modelContext`. Rejects when the first registration fails, with the browser's error as the cause.

| Option      | Default                 | Meaning                                                  |
| ----------- | ----------------------- | -------------------------------------------------------- |
| `actor`     | `vacpAgentActor`        | Attribution of every step and sentence                   |
| `namespace` | `"vacp"`                | Prefix of every tool name                                |
| `onError`   |                         | Receives a failed registration after a capability change |
| `signal`    |                         | Removes the tools when aborted                           |
| `context`   | `document.modelContext` | The registry, `{ registerTool(tool, options?) }`         |

`VacpWebMcpSource` is the part of the runtime the installation uses: `observe`, `getCapabilities`, `getState`, `execute`, `narrate`, `subscribeCapabilities`, and `signal`.

### VacpWebMcpInstallation

| Member      | Behavior                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `refresh()` | Reads the graph and resolves once it, or a newer graph, is registered   |
| `error`     | The last failed automatic registration, cleared by a successful refresh |
| `toolNames` | The registered tool names                                               |
| `dispose()` | Removes this installation's tools and leaves the runtime running        |

Disposing the runtime disposes the installation.

## compileVacpWebMcpTools

```ts
compileVacpWebMcpTools(graph: VacpGraph, client: VacpWebMcpClient, options?: { actor?; namespace? }): WebMCP.ModelContextTool[]
```

Compiles one graph into tool definitions without registering them: the three read tools and one tool per available operation. Throws a `TypeError` for an invalid or duplicate tool name. The installation adds the progress tool.
