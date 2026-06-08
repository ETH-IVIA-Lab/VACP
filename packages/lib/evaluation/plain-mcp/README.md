The plain MCP server exposes semantic tools for one visual analytics use case at a time.
It runs a Playwright-controlled browser page and uses the page's VACP bridge
inside the server process to execute the semantic actions.

MCP clients receive only the selected use case's predefined tools. The hidden
runtime keeps VACP capabilities, state snapshots, action ids, refs, and browser
primitives inside the server process. The server does not register raw VACP tools
or generic browser tools. Data query tools call the bridge-backed
`vacp.data_sql` action and return its JSON result shape with semantic criteria
attached.

Run one use case against the examples host:

```bash
uv run plain-mcp UC1 --url http://localhost:5173/ --startup-wait-for-bridge
```

Use case routes and tools:

| ID | Route | Tools |
| --- | --- | --- |
| `UC1` | `/vega-lite/#global-development` | `get_bubble_chart_state`, `set_year`, `zoom_chart`, `hover_country`, `query_gapminder_data` |
| `UC2` | `/vega-lite/#seattle-weather` | `get_weather_chart_state`, `brush_date_range`, `select_weather_category`, `hover_weather_point`, `query_weather_data` |
| `UC3` | `/vgplot/#athletes` | `get_athlete_dashboard_state`, `set_sport_filter`, `set_gender_filter`, `brush_scatterplot`, `sort_table`, `query_athlete_data` |
| `UC4` | `/vega-lite/#airports` | `get_flight_map_state`, `select_airport`, `filter_routes`, `hover_route`, `query_flight_data` |
| `UC5` | `/cars-parcoords/` | `get_pcp_state`, `set_axis_order`, `brush_axis_range`, `clear_brushes`, `query_cars_data` |

The CLI accepts the same browser and transport flags as `vacp-mcp-server`, including
`--url`, `--transport`, `--stdio`, `--cdp-url`, `--reuse-page-url-contains`,
`--headless`, and startup readiness flags. `--enable-browser-tools` is accepted
for CLI parity, but this package does not register generic browser tools.
