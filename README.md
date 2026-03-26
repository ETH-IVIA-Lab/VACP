# VACP: Visual Analytics Context Protocol

<!-- [![DOI:tbd](https://zenodo.org/badge/DOI/tbd.svg)](https://doi.org/tbd) -->
<!-- [![arxiv badge](https://img.shields.io/badge/arXiv-tbd-red)](https://arxiv.org/abs/tbd) -->
<!-- [![NPM - Downloads](https://img.shields.io/npm/dm/tbd)](https://www.npmjs.com/package/tbd) -->

VACP (Visual Analytics Context Protocol) is a small in-app contract for exposing capabilities, VA interface state snapshots, and semantic actions and providing interface accessibility to AI agents for interactive Visual Analytics.

[Learn more about VACP at the documentation site](https://docs.vacp.dev), or [read the VACP research paper](https://arxiv.org/abs/tbd).

If referencing VACP, please use the following citation:
<!-- , to appear in 2026 IEEE VIS Conference -->
```bibTeX
@article{staehle2026vacp,
  title = {{VACP}: {Visual Analytics Context Protocol}},
  shorttitle = {{VACP}},
  author = {{St{\"a}hle}, Tobias and {Gyarmati}, Péter Ferenc and {Spinner}, Thilo and {Sevastjanova}, Rita and {Moritz}, Dominik and {El-Assady}, Mennatallah},
  year = {2026},
  journal = {arXiv preprint arXiv:tbd},
  doi = {10.48550/arXiv.tbd} 
}
```

## Fast Path

From repo root:

- Install dependencies: `pnpm install` and `uv sync`
- Build workspace: `pnpm build`
- Start examples gallery: `pnpm dev`
- Run checks: `pnpm test:e2e` and `pnpm test:mcp`

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

Visit [https://docs.vacp.dev/](https://docs.vacp.dev/) to view the full documentation and [https://examples.vacp.dev/](https://examples.vacp.dev/) to view the demos.

- Docs site entry: [docs/index.md](docs/index.md)
- Get started: [docs/get-started/index.md](docs/get-started/index.md)
- Overview: [docs/what-is-vacp/index.md](docs/what-is-vacp/index.md)
- Core runtime: [docs/core-runtime/index.md](docs/core-runtime/index.md)
- Tool contract: [docs/reference/tool-contract.md](docs/reference/tool-contract.md)
- Runtime configuration: [docs/reference/configuration.md](docs/reference/configuration.md)
- Architecture spec: [ARCHITECTURE.md](ARCHITECTURE.md)
- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## Runtime Notes

- Enable in-page debug overlay with `?vacp-debug=1` or `VACP_DEBUG_UI=1`.
- Start MCP server against a running example: `uv run vacp-mcp-server --url http://localhost:<vite-port>/`.

## Contact
If you have any questions, feel free to [open an issue](https://github.com/ETH-IVIA-Lab/VACP/issues/new/choose) or contact [Tobias Stähle](https://ivia.ch/people/staehle).
