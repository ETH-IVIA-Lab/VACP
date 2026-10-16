# Examples

The [examples gallery](https://examples.vacp.dev/) hosts five analytical applications. Each composes its sources into one runtime, publishes `window.__vacp`, registers WebMCP tools when the browser supports them, and shows agent presence with replay.

| Example                                                                | Sources                                         | Try                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| [Olympic athletes](https://examples.vacp.dev/athletes/)                | Vega-Lite, Mosaic vgplot, and a cohort model    | Brush age, then ask an agent which sports have the tallest athletes   |
| [vgplot gallery](https://examples.vacp.dev/vgplot/)                    | Mosaic vgplot, 50 specifications                | Pick `nyc-taxi-rides` and brush the pickup hours                      |
| [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/)              | Vega-Lite, 3 specifications                     | Pick Seattle weather and brush a date range                           |
| [React dashboard](https://examples.vacp.dev/react-dashboard/)          | Recharts and TanStack Table through `@vacp/sdk` | Pick a dataset and an encoding, then brush the scatter plot           |
| [Cars parallel coordinates](https://examples.vacp.dev/cars-parcoords/) | D3 through `@vacp/sdk`                          | Reorder the axes, then brush ranges across seven measures of 392 cars |

The Olympic athletes example composes three sources in one runtime, as [Compose sources](../composition/) shows.

Three vgplot specifications, `gaia`, `nyc-taxi-rides`, and `observable-latency`, stream their datasets from a remote bucket and need network access.

To read an example from the console, run the gallery locally, or connect an agent, follow [Get started](../get-started/).
