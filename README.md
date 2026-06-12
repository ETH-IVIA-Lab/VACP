# VACP: Visual Analytics Context Protocol

[![arXiv:2603.29322](https://img.shields.io/badge/arXiv-2603.29322-red)](https://arxiv.org/abs/2603.29322)

![AI agents use VACP to read visual analytics state, discover available interactions, and execute semantic actions that update the interface state.](docs/public/images/VACP_Teaser.svg)
VACP (Visual Analytics Context Protocol) is a small in-app contract for exposing capabilities, visual analytics state snapshots, and semantic actions to AI agents.

[Learn more about VACP at the documentation site](https://docs.vacp.dev), or [read the VACP research paper](https://arxiv.org/abs/2603.29322).

If you reference VACP, use the following citation:

```bibTeX
@misc{staehle2026vacp,
  title = {{VACP}: {Visual Analytics Context Protocol}},
  author = {{St{\"a}hle}, Tobias and {Gyarmati}, Péter Ferenc and {Spinner}, Thilo and {Sevastjanova}, Rita and {Moritz}, Dominik and {El-Assady}, Mennatallah},
  year = {2026},
  eprint = {2603.29322},
  archivePrefix = {arXiv},
  doi = {10.48550/arXiv.2603.29322}
}
```

## Fast Path

From repo root:

- Install dependencies: `pnpm install` and `uv sync`
- Build workspace: `pnpm build`
- Start examples gallery: `pnpm dev`
- Run checks: `pnpm test`

For full setup and command details, use [docs/get-started/index.md](docs/get-started/index.md).

## What Is In This Repo

- Protocol/runtime primitives: `packages/lib/protocol/*`
- Provider adapters: `packages/lib/providers/*`
- Transport adapters: `packages/lib/transports/*`
- Tooling packages: `packages/lib/tooling/*`
- Evaluation tooling: `packages/lib/evaluation/*`
- Runnable examples and index host: `packages/examples/*`
- End-to-end tests: `packages/testing/e2e`

## Documentation

Visit [https://docs.vacp.dev/](https://docs.vacp.dev/) for the documentation and [https://examples.vacp.dev/](https://examples.vacp.dev/) for demos. Click the floating **VACP** control, select Chat, enter your API key, and ask the agent to analyze or interact with the active visualization.

- Docs site entry: [docs/index.md](docs/index.md)
- Get started: [docs/get-started/index.md](docs/get-started/index.md)
- Overview: [docs/what-is-vacp/index.md](docs/what-is-vacp/index.md)
- Core runtime: [docs/core-runtime/index.md](docs/core-runtime/index.md)
- Tool contract: [docs/reference/tool-contract.md](docs/reference/tool-contract.md)
- Runtime configuration: [docs/reference/configuration.md](docs/reference/configuration.md)
- Architecture spec: [ARCHITECTURE.md](ARCHITECTURE.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## Runtime Notes

- The in-page debug overlay is enabled by default. Disable it with `?vacp-debug=0` or `VACP_DEBUG_UI=0`.
- Start MCP server against a running example: `uv run vacp-mcp-server --url http://localhost:<vite-port>/`.

## Contact

For questions, [open an issue](https://github.com/ETH-IVIA-Lab/VACP/issues/new/choose) or contact [Tobias Stähle](https://ivia.ch/people/staehle).
