# Get started

Run an example, read its observation, and let an agent change the charts through MCP.

## Read an example from the console

Open the [Olympic athletes example](https://examples.vacp.dev/athletes/). Brush the age histogram, then run this in the browser console:

```js
const { graph, state } = await window.__vacp.observe();
graph.nodes.filter((node) => node.layer === 'InteractionFeedbackLayer').map((node) => [node.title, state[node.ref]]);
```

Each pair names an interaction and holds its current state. The age brush reads `{ kind: 'Interval1D', selectionValue: [22, 28], ... }` for a brush from 22 to 28 years. Brush again and rerun the read to see the new range.

## Clone and build the repository

The MCP server and the local gallery run from a checkout. You need [pnpm](https://pnpm.io/installation) 11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/), the Python package manager. pnpm switches to the release the repository pins and downloads the Node.js version it declares.

```bash
git clone https://github.com/ETH-IVIA-Lab/VACP.git
cd VACP
make setup build
make dev
```

`make dev` serves the gallery at `https://examples.vacp.localhost` through [Portless](https://github.com/vercel-labs/portless), a local proxy that gives each app a stable HTTPS name. The first run asks to trust its local certificate.

## Connect an agent through MCP

The `vacp` Python package runs an [MCP](https://modelcontextprotocol.io) server. MCP is the protocol agent clients such as Claude Code, Codex, and Cursor use to call external tools. The server opens the page in a Chromium window and serves the page's runtime to the agent as the five VACP tools, plus tools to open a URL and read the page's URL and title.

Install Chromium for the server once:

```bash
uv run --package vacp playwright install chromium
```

Register the server with your MCP client. For Claude Code, run this from the repository root:

```bash
claude mcp add vacp -- uv run --directory "$PWD" --package vacp vacp \
  --transport stdio --url https://examples.vacp.dev/athletes/
```

Other clients take the same command in their MCP server settings. To serve over HTTP instead, run `uv run --package vacp vacp --url <page>`, and point the client at `http://localhost:8000/mcp`.

Ask the agent a question about the data, for example "Compare rowers and canoeists aged 22 to 28." The Chromium window shows the agent's cursor moving to each control it changes, with a bubble beside it that shows the agent's sentence for each step. When the agent finishes, hover the bubble to step back through its checkpoints.

## Next steps

- Read the [core concepts](../concepts/) behind observations and operations.
- [Connect your own application](../integrate/) with `@ethivia/vacp-sdk`.
- Add VACP to a [Vega-Lite](../vega-lite/) or [Mosaic vgplot](../vgplot/) view.
- Run an agent [inside the page](../agents/) or through [WebMCP](../agents/webmcp).
