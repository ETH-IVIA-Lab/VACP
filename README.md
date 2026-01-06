# VACP Monorepo (pnpm + uv)

This folder is a standalone VACP monorepo that keeps:

- **TypeScript packages** (via `pnpm`) under `vacp/packages/*`
- **Python packages** (via `uv`) under `vacp/packages/server/*`

The design goal is to keep VACP reusable across apps while providing a first-class
integration for Mosaic/vgplot.

## JS/TS workspace

- Install: `pnpm install`
- Build: `pnpm -r build`
- Lint: `pnpm -r lint`
- Format: `pnpm format`

## Python workspace

- Create env + install: `uv sync`
- Run server (example): `uv run vacp-mcp-server --help`
- Lint/format: `uv run ruff check .` / `uv run ruff format .`
- Typecheck: `cd packages/server/vacp-mcp-server && uv run --with ty ty check src/vacp_mcp_server`
