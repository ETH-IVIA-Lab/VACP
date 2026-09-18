# What is VACP?

VACP gives an agent a semantic interface to a visualization. It describes what the visualization contains, reports its current state, and exposes actions that update the same controls people use.

A scatterplot might expose a selection as `vacp://analysis/scatter/selection`. An agent can read its bounds, discover a brush action, and change the selection. The chart remains responsible for rendering the result.

## Three operations

| Operation           | Result                                                  |
| ------------------- | ------------------------------------------------------- |
| `getCapabilities()` | A graph of semantic entities and the available actions. |
| `getState()`        | Current values keyed by stable references.              |
| `execute(call)`     | An action result or a structured error.                 |

A **ref** identifies an entity across rerenders. Nodes represent views, marks, selections, parameters, widgets, and data handles. Edges describe relationships such as containment and control.

State holds the values that change during interaction. Capabilities describe the entities and operations used to interpret those values. Large datasets stay in the application and are accessed through data actions.

## Integrations and consumers

A provider maps a visualization into this contract. You can use a provider for Vega-Lite or VGPlot, or [define a custom integration](../integrate/).

The [Inspector](../inspector/) and [agents](../transports/) consume the same contract. Screenshots still provide visual feedback, while semantic state provides exact values and actions.

The [runtime](../reference/runtime) adds history, replay, subscriptions, and scoped state updates. The [browser adapter](../reference/browser) exposes it at `window.__vacp` and can publish snapshots into the DOM.
