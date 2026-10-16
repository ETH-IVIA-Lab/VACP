# VACP for Python

The `vacp` package defines transport-neutral provider, observation, operation, freshness, and composition records for Python analytical systems.

Requires Python 3.10 through 3.14. Install the package with [pip](https://pip.pypa.io/en/stable/):

```bash
pip install vacp
```

Compose your application's providers with `ProviderComposer`:

```python
from vacp import ProviderComposer

runtime = ProviderComposer([widget_provider, notebook_provider])
observation = await runtime.observe()
```

Install the server extra to connect an external MCP client to a VACP-enabled browser page:

```bash
uv pip install 'vacp[server]'
python -m playwright install chromium
vacp --url http://127.0.0.1:5173/vgplot/
```

The default MCP endpoint is `http://localhost:8000/mcp`, with a health check at `/healthz`. Pass `--transport stdio` for standard input and output. The server exposes `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_execute`, and `vacp_progress`. Each `vacp_execute` call takes a `narration` sentence for its step, which the execution carries: the person watching sees it as the step begins, and replay shows it with the step. `vacp_progress` adds an opening and a closing sentence through the page runtime's narrator, which closes a quiet turn once no step is in flight. A page whose bridge cannot narrate fails the call. Steps and sentences are attributed to `AGENT_ACTOR`, `{'id': 'agent', 'kind': 'agent', 'label': 'Agent'}`.

`SimpleProvider(source, observe, prepare, subscribe, dispose)` assembles a provider from its members. `prepare(call, context)` validates an `ActionCall` without mutating the source and returns a single-use `PreparedAction`. `ProviderComposer` validates node and action ownership, permits cross-source edges, and captures one revisioned observation per read, isolated from later provider changes. `ProviderComposer.execute(call)` prepares the call with its owner, rechecks lifetime and eligibility, then runs it once.

Run `make python-check` from the repository root for Python lint, type checks, and tests.

See the [Python API reference](https://docs.vacp.dev/api/python) for providers, CLI options, and the `http` extra. VACP is licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
