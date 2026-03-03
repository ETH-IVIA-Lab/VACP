# VACP

VACP (Visual Analytics Context Protocol) is a small in-app contract for exposing capabilities, state snapshots, and semantic actions for interactive visual analytics.

## Fast Path

From repo root:

- Install dependencies: `pnpm install` and `uv sync`
- Build workspace: `pnpm build`
- Start examples gallery: `pnpm dev`
- Run checks: `pnpm test:examples` and `pnpm test:server`

For full setup and command details, use [docs/get-started/index.md](docs/get-started/index.md).

## What Is In This Repo

- TypeScript protocol/runtime packages: `packages/lib/*`
- Runnable examples and gallery host: `packages/examples/*`
- Python MCP transport: `packages/vacp-mcp-server`
- Arena tooling for evaluation runs: `packages/agent-arena`

## Documentation

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
