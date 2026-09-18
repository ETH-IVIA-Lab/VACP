# Evaluation

Evaluation runners, comparison tools, analysis, and their documentation live here. These projects use the repository's root pnpm and uv workspaces, dependency catalogs, and lockfiles.

| Project          | Purpose                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `agent-arena`    | Run agent scenarios, collect transcripts, score outcomes, and generate reports. |
| `plain-mcp`      | Expose the use-case-specific MCP comparison surface.                            |
| `arena-analysis` | Extract and validate transcript state in Python.                                |

From the repository root:

```bash
pnpm install --frozen-lockfile
uv sync --all-packages --all-groups --locked
pnpm --filter @vacp/agent-arena build
pnpm --filter @vacp/agent-arena test
make python-check
```

## Integration boundary

The application under evaluation is selected by `VACP_ARENA_BASE_URL`. Evaluation interacts with it through its browser and public protocol, without importing example source code or reading example data files.

`plain-mcp` declares a dependency on the reusable `vacp` Python package. Agent Arena launches MCP commands in that package's evaluation environment. Configuration and run paths are resolved within `evals/`, while TypeScript and Python development tools remain shared at the repository root.

Product libraries, documentation hosting, and examples must not depend on evaluation projects. If these tools move to another repository, supply its workspace/toolchain configuration and resolve `vacp` from a distribution or source checkout. The product's source layout is not an evaluation API.

## Guides

- [Workflows](docs/workflows.md)
- [Agent Arena](docs/agent-arena.md)
- [Plain MCP comparison](docs/plain-mcp.md)
- [State analysis](docs/state-analysis-guide.md)
