# Contributing

Thanks for your interest in VACP. This repo is a small pnpm TypeScript workspace plus a Python MCP server.

## Getting set up

From the repo root:

1. Install JS deps: `pnpm install`
2. Install Python env: `uv sync`
3. Install Playwright browsers:
   - JS tests: `pnpm exec playwright install chromium`
   - Python server: `uv run playwright install chromium`

## Common commands

- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Format: `pnpm format` (or `pnpm format:check`)
- Web smoke tests (runs the examples): `pnpm test:examples`
- MCP server tests: `pnpm test:server`

## Code style

- TypeScript: formatted with Prettier; linted with Oxlint.
- Python: formatted/linted with Ruff (`uv run ruff check .` in `packages/vacp-mcp-server/`).
