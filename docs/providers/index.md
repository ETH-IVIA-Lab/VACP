# Providers

A provider translates a visualization's entities and interactions into capabilities, state, and semantic actions.

| Visualization                                 | Integration                              |
| --------------------------------------------- | ---------------------------------------- |
| Vega-Lite rendered through a Vega view        | [`@vacp/adapter-vega-lite`](./vega-lite) |
| Mosaic VGPlot plots and tables                | [`@vacp/adapter-vgplot`](./vgplot)       |
| Custom controls, charts, or application state | [`@vacp/sdk`](../integrate/)             |

Keep rendering and application state in the visualization. The provider reads that state and applies actions through the visualization's own operations.
