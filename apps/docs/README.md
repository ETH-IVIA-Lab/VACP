# Documentation site

VitePress configuration, theme, and static assets live here. User-facing Markdown lives in top-level `docs/`. Internal guides live in `development_docs/`, with evaluation-specific material in `evals/docs/`.

From the repository root:

```bash
pnpm --filter @vacp/docs dev
pnpm --filter @vacp/docs build
```

Development uses `https://docs.vacp.localhost` through Portless. Run `make docs-serve` from the root. For built output, run `pnpm --filter @vacp/docs preview` and open the URL VitePress prints.
