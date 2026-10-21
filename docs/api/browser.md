# @ethivia/vacp-browser

Installs a runtime in a page, publishes it as the page bridge, and writes each observation into the DOM.

## installVacpRuntime

```ts
installVacpRuntime(options: {
  providers: readonly VacpProvider[];
  exposeBridge: boolean;
  injectDomSnapshot: boolean;
  sessionKey?: string;
  globalKey?: string;
  runtimeId?: string;
}): { runtime: VacpRuntime; dispose(): void }
```

Installs one runtime per `globalKey` and attaches `providers` to it.

| Option              | Default     | Meaning                                                                                                              |
| ------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `providers`         | required    | The providers this installation attaches                                                                             |
| `exposeBridge`      | required    | Publish the runtime at `window[globalKey]`. With `false`, the runtime stays reachable through the returned `runtime` |
| `injectDomSnapshot` | required    | Write each observation into `application/json` script elements, described in [DOM snapshot](#dom-snapshot)           |
| `sessionKey`        |             | The analytical session. A different key replaces every source and starts a new provenance epoch                      |
| `globalKey`         | `'__vacp'`  | The `window` property the bridge is published at, and the key installations share                                    |
| `runtimeId`         | a random ID | The runtime's identity                                                                                               |

A second installation at the same key reuses the runtime: providers with new source IDs join it, and a provider with an existing source ID replaces that source. `dispose()` detaches the providers this installation attached. When none remain, it disposes the runtime and removes the bridge and snapshot scripts. Calling `dispose()` again does nothing.

## getVacpBridge

```ts
getVacpBridge(options?: { globalKey?: string }): VacpPageBridge | undefined
```

Returns the bridge at `window[globalKey]`, or `undefined` when nothing is installed, the protocol version differs, or a required member is missing.

## uninstallVacpRuntime

```ts
uninstallVacpRuntime(options?: { globalKey?: string }): void
```

Disposes the runtime at `globalKey` regardless of how many installations attached providers, and removes the bridge.

## DOM snapshot

The base script (`__vacp_snapshot` by default) holds a `vacp.dom_snapshot` manifest that links the other scripts by ID:

| Script        | `data-vacp`              | Contents                                                                                       |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| Manifest      | `snapshot`               | `observation.revision`, sources, freshness, and the IDs of the graph, state index, and catalog |
| Graph         | `snapshot-graph`         | Nodes, edges, and actions, with a `token` that changes when the graph changes                  |
| State catalog | `snapshot-state-catalog` | One entry per ref with its `scriptId`, kind, layer, and title, and a `token` for the catalog   |
| State index   | `snapshot-state-index`   | `revision`, `baseRevision`, `changedRefs`, `removedRefs`, and whether the catalog changed      |
| Ref           | `snapshot-ref`           | One ref's `value` and optional `summary`                                                       |

Every script carries `data-vacp-root` with the base script ID, and each ref script carries `data-vacp-snapshot-ref` with its ref.

The runtime writes a snapshot when the observation revision or the graph changes. Each ref is compared with the value last written, so unchanged refs keep their script text, and the graph and catalog scripts are rewritten only when they change.

The state index names the revision it describes and, after the first write, the revision written before it:

- A reader holding `baseRevision` reaches `revision` by rereading the ref scripts in `changedRefs` and dropping those in `removedRefs`. When `catalog.changed` is true, reread the catalog first to find the scripts of newly added refs.
- A graph change that leaves state alone, or another listener subscribing to the runtime's snapshots, writes again at the same revision. Then `baseRevision` equals `revision` and both lists are empty.
- A reader holding any other revision rereads the catalog and every ref script it lists.
