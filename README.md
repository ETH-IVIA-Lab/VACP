# VACP: Visual Analytics Context Protocol

[![arXiv:2603.29322](https://img.shields.io/badge/arXiv-2603.29322-red)](https://arxiv.org/abs/2603.29322)

![AI agents use VACP to read visual analytics state, discover available interactions, and execute named operations that update the charts.](docs/public/images/VACP_Teaser.svg)

VACP lets AI agents read and change visual analyses through named operations, while the person using them watches each step. Providers describe [Vega-Lite](https://vega.github.io/vega-lite/) charts, [Mosaic vgplot](https://idl.uw.edu/mosaic/vgplot/) dashboards, and custom applications as one graph of views, selections, parameters, and data handles. Agents connect through the [Model Context Protocol](https://modelcontextprotocol.io) (MCP), [AI SDK](https://ai-sdk.dev) tools, or [WebMCP](https://webmachinelearning.github.io/webmcp/). Presence shows the agent's cursor and one sentence per step, and replay restores the charts to each checkpoint.

Try the [examples gallery](https://examples.vacp.dev/), then read the [documentation](https://docs.vacp.dev/).

## Run it locally

Install [pnpm](https://pnpm.io/installation) 11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/). pnpm switches to the pinned release and downloads the declared Node.js.

```bash
make setup build
make dev
```

`make dev` serves the gallery at `https://examples.vacp.localhost`. To let an MCP client such as Claude Code drive an example, follow [Get started](docs/get-started/index.md#connect-an-agent-through-mcp).

## Repository

| Path                | Contents                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/`         | The protocol, runtime, providers, transports, presence, and the Python package                                     |
| `examples/`         | The gallery and its five applications                                                                              |
| `apps/e2e`          | Playwright tests through the browser and the public bridge                                                         |
| `apps/evals`        | Agent evaluations on the examples                                                                                  |
| `docs/`             | The documentation site                                                                                             |
| `development_docs/` | [Development guides](development_docs/index.md) for architecture, contributing, testing, examples, and performance |

Run `make check` for every static gate and unit suite, and `make browser-install e2e` for the browser suite.

## Citation

```bibtex
@misc{staehle2026vacp,
  title = {{VACP}: {Visual Analytics Context Protocol}},
  author = {{St{\"a}hle}, Tobias and {Gyarmati}, Péter Ferenc and {Spinner}, Thilo and {Sevastjanova}, Rita and {Moritz}, Dominik and {El-Assady}, Mennatallah},
  year = {2026},
  eprint = {2603.29322},
  archivePrefix = {arXiv},
  doi = {10.48550/arXiv.2603.29322}
}
```

For questions, [open an issue](https://github.com/ETH-IVIA-Lab/VACP/issues/new/choose) or contact [Tobias Stähle](https://ivia.ch/people/staehle).
