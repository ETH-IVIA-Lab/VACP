# VACP for Python

The `vacp` package defines transport-neutral provider, observation, operation, freshness, and composition records for Python analytical systems.

```python
from vacp import ProviderComposer

runtime = ProviderComposer([widget_provider, notebook_provider])
observation = await runtime.observe()
```

Install the server extra to connect an external MCP client to a VACP-enabled browser page:

```bash
uv pip install 'vacp[server]'
vacp --url http://127.0.0.1:5173/vgplot/
```

The default MCP endpoint is `http://localhost:8000/mcp`. Pass `--transport stdio` for standard input and output. The server exposes `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_execute`, and `vacp_progress`. Each `vacp_execute` call takes a `narration` sentence for its step, which the execution carries: the person watching sees it as the step begins, and replay shows it with the step. `vacp_progress` adds an opening and a closing sentence through the page runtime's narrator, which closes a quiet turn once no step is in flight.

`SimpleProvider` binds Python source metadata, observation, invocation, invalidation, and cleanup callbacks. `ProviderComposer` validates node and operation ownership, permits cross-source edges, and produces one revisioned observation.

Run `make python-check` from the repository root for Python lint, type checks, and tests.
