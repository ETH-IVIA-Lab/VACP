# Browser adapter

`@vacp/runtime-browser` installs a composed runtime, exposes its bridge, and publishes DOM observations.

```ts
import { getVacpBridge, installVacpRuntime } from '@vacp/runtime-browser';

const installation = installVacpRuntime({ providers: [controls, chart], sessionKey: 'overview' });
const runtime = installation.runtime;
const bridge = getVacpBridge();

installation.dispose();
```

Installing a provider with a new source ID adds it to the runtime. Installing the same source ID replaces its binding. A changed `sessionKey` replaces the full source set and starts a new history boundary.

`getVacpBridge()` returns `undefined` when no bridge is exposed, the protocol version differs, or a required method is missing. `bridge.observe()` reads the current composed observation.

`injectDomSnapshot` controls JSON publication in script elements. `domSnapshotScriptId` overrides the base script ID. With bridge exposure disabled, the runtime remains available to its installing application.

`uninstallVacpRuntime()` disposes every provider attached to that global key and removes the bridge and DOM observation scripts.

## DOM snapshot

The base script (`__vacp_snapshot` by default) holds a `vacp.dom_snapshot` manifest that links the other scripts by ID:

| Script        | Contents                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Manifest      | `observation.revision`, sources, freshness, and the IDs of the graph, state index, and catalog |
| Graph         | Nodes, edges, and actions, with a `token` that changes when the graph changes                  |
| State catalog | One entry per ref with its `scriptId`, kind, layer, and title, and a `token` for the catalog   |
| State index   | `revision`, `baseRevision`, `changedRefs`, `removedRefs`, and whether the catalog changed      |
| Ref           | One ref's `value` and optional `summary`                                                       |

The runtime writes a snapshot when the observation revision or the graph changes. Each ref is compared with the value last written, so unchanged refs keep their script text, and the graph and catalog scripts are rewritten only when they change.

The state index names the revision it describes and, after the first write, the revision written before it:

- A reader holding `baseRevision` reaches `revision` by rereading the ref scripts in `changedRefs` and dropping those in `removedRefs`. When `catalog.changed` is true, reread the catalog first to find the scripts of newly added refs.
- A graph change that leaves state alone, or another listener subscribing to the runtime's snapshots, writes again at the same revision. Then `baseRevision` equals `revision` and both lists are empty.
- A reader holding any other revision rereads the catalog and every ref script it lists.

## Configuration

Pass `exposeBridge` and `injectDomSnapshot` directly to `installVacpRuntime`. Install the Inspector separately at the application boundary.

See [configuration](./configuration) for flags and precedence.
