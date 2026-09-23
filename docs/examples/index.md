# Examples

Each example exposes the same observation and operation contract.

| Example                                                           | Explore                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| [Athlete explorer](https://examples.vacp.dev/athletes/)           | Rio 2016 athletes across Vega-Lite, vgplot, and D3 views. |
| [VGPlot](https://examples.vacp.dev/vgplot/)                       | Flights, taxi rides, weather, and more in linked views.   |
| [Vega-Lite](https://examples.vacp.dev/vega-lite/)                 | Airports, global development, and Seattle weather.        |
| [Parallel coordinates](https://examples.vacp.dev/cars-parcoords/) | 392 cars across seven reorderable measures.               |
| [React dashboard](https://examples.vacp.dev/react-dashboard/)     | Iris and Motor Trend with linked charts and a table.      |

Each example composes agent presence, paced agent steps, and the replay stepper through one shared integration, so an agent working through MCP or WebMCP is visible the same way in all of them. Change a control, then call `await window.__vacp.observe()` in the browser console to read its graph and state. Use [Inspector Core](../inspector/) to build a custom inspection surface.

Use the [local setup](../get-started/) to run these examples from a checkout.
