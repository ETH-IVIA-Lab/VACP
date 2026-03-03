# Contributing

## Setup

From the repo root:

1. Install JS deps: `pnpm install`
2. Build workspace packages: `pnpm build`
3. Install Python env: `uv sync`
4. Install browsers:
   - JS tests: `pnpm --filter @vacp/e2e exec playwright install chromium`
   - Python transport tests: `uv run playwright install chromium`

## Quality Gates

- Format check: `pnpm format:check`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Web smoke tests: `pnpm test:e2e`
- MCP server tests: `pnpm test:mcp`

## Code Style

- TypeScript formatting: `oxfmt`
- TypeScript linting: `oxlint`
- Python linting/formatting: `uv run ruff check .` (in `packages/lib/transports/mcp-server/`)

## Documentation

- Canonical run/setup commands: `docs/get-started/index.md`
- Runtime knobs and precedence: `docs/reference/configuration.md`
