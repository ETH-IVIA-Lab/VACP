# Examples

The [examples gallery](https://examples.vacp.dev/) hosts five analytical applications. Each one composes its sources into one runtime, publishes `window.__vacp`, registers [WebMCP](../agents/webmcp) tools when the browser supports them, and shows agent [presence](../presence/) with replay.

| Example                                                                | Sources                                                                                                     | Try                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Olympic athletes](https://examples.vacp.dev/athletes/)                | [Vega-Lite](../vega-lite/), [Mosaic vgplot](../vgplot/), and a cohort model                                 | Brush age, then ask an agent which sports have the tallest athletes   |
| [vgplot gallery](https://examples.vacp.dev/vgplot/)                    | Mosaic vgplot, 50 specifications                                                                            | Pick NYC Taxi Rides and brush the pickup hours                        |
| [Vega-Lite gallery](https://examples.vacp.dev/vega-lite/)              | Vega-Lite, 3 specifications                                                                                 | Pick Seattle Weather and brush a date range                           |
| [React dashboard](https://examples.vacp.dev/react-dashboard/)          | [Recharts](https://recharts.org) and [TanStack Table](https://tanstack.com/table) through a custom provider | Pick a dataset and an encoding, then brush the scatter plot           |
| [Cars parallel coordinates](https://examples.vacp.dev/cars-parcoords/) | [D3](https://d3js.org) through a custom provider                                                            | Reorder the axes, then brush ranges across seven measures of 392 cars |

[Compose sources](../composition/) explains the Olympic athletes example. The vgplot specifications `gaia`, `nyc-taxi-rides`, and `observable-latency` stream their datasets from a remote bucket and need network access.

## Read an example from the console

Open an example and run this in the browser's developer console:

```js
await window.__vacp.observe();
```

[Core concepts](../concepts/) explains each field of the result.

## Connect an agent to an example

The `vacp` Python package runs an [MCP](https://modelcontextprotocol.io) server that opens the example in Chromium. MCP is the protocol agent clients use to call tools. Install Chromium for the server once, as [Get started](../get-started/#let-an-agent-move-the-slider) shows, then register the server with Claude Code:

```bash
claude mcp add vacp -- uvx --from 'vacp[server]' vacp --url https://examples.vacp.dev/athletes/
```

[Connect an agent](../agents/) covers other clients.

## Run the gallery locally

```bash
git clone https://github.com/ETH-IVIA-Lab/VACP
cd VACP
pnpm install
pnpm dev
```

`pnpm dev` serves the gallery at `https://examples.vacp.localhost` through [Portless](https://github.com/vercel-labs/portless), a local proxy that gives each app an HTTPS name. Its first run asks you to trust a local certificate authority.
