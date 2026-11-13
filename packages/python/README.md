# vacp

`vacp` connects AI agents to a VACP page. Its MCP server opens the page in a browser and lets clients such as Claude Code, Codex, and Cursor read the page's charts and controls and change them through named actions while the person watches. The package also defines providers for Python analytical applications.

Requires Python 3.10 through 3.14.

## Run the MCP server

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) is the protocol agent clients use to call external tools. Run the server with [uv](https://docs.astral.sh/uv/), the Python package manager. The first command installs the Chromium the server drives. The second registers the server with Claude Code, which starts it and talks to it over stdio:

```bash
uvx --from 'vacp[server]' playwright install chromium
claude mcp add vacp -- uvx --from 'vacp[server]' vacp --url http://localhost:5173/
```

The server opens your page in a Chromium window and waits for its bridge. The page must install its VACP runtime with `exposeBridge: true`. Other MCP clients take the same command. For a client that connects over HTTP, add `--transport http` and connect to `http://localhost:8000/mcp`.

Ask the agent to change something on the page, and the change appears in the Chromium window.

## Use it from Python

Add the package to a project with `uv add vacp`. `Runtime` composes Python providers into one observation and runs their actions. With the `http` extra, `vacp.http.create_inspection_app` serves a runtime to a browser inspector.

## Documentation

- [Get started](https://docs.vacp.dev/get-started/) builds a page an agent can drive.
- [Connect an agent](https://docs.vacp.dev/agents/) covers MCP clients and the server's options.
- [Python reference](https://docs.vacp.dev/api/python) documents the `vacp` command, providers, and `create_inspection_app`.

VACP is licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
