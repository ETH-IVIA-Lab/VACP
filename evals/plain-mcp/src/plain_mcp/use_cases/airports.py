from __future__ import annotations

from typing import Annotated, cast

from pydantic import Field

from plain_mcp.protocol import ToolCallable, ToolSpec, UseCaseSpec
from plain_mcp.runtime import JsonDict, PlainMcpRuntime, as_dict
from plain_mcp.sql import (
    action_response,
    clean_limit,
    data_response,
    lower_like,
    numeric_range,
    quote_table_ref,
    select_with_total,
    sql_literal,
    string_equals,
    where_clause,
)

ORG_REF = 'vacp://vacp-examples/vega-lite/airports/airports/param/org'
ROUTES_REF = 'vacp://vacp-examples/vega-lite/airports/airports/data/main'
AIRPORTS_REF = 'vacp://vacp-examples/vega-lite/airports/airports/data/src/airports'

_ROUTE_COLUMNS = (
    'origin',
    'destination',
    'TRY_CAST(count AS INTEGER) AS count',
)


def _airport_summary(value: object, remembered: JsonDict) -> JsonDict:
    if remembered:
        return {
            key: remembered.get(key)
            for key in ('iata', 'name', 'city', 'state', 'country', 'latitude', 'longitude')
            if remembered.get(key) is not None
        }
    if isinstance(value, dict):
        typed = cast(dict[str, object], value)
        origin = typed.get('origin')
        if origin:
            return {'iata': origin}
    return {}


def _hover_summary(value: object | None) -> JsonDict | None:
    if not isinstance(value, dict):
        return None
    typed = cast(dict[str, object], value)
    summary = {key: typed.get(key) for key in ('origin', 'destination') if typed.get(key) is not None}
    return summary or None


async def _airport_lookup(runtime: PlainMcpRuntime, airport: str) -> JsonDict:
    value = airport.strip()
    exact = sql_literal(value.lower())
    sql = (
        'WITH candidates AS ('
        'SELECT iata, name, city, state, country, TRY_CAST(latitude AS DOUBLE) AS latitude, '
        'TRY_CAST(longitude AS DOUBLE) AS longitude, '
        f'CASE WHEN LOWER(iata) = {exact} THEN 0 ELSE 1 END AS __rank '
        f'FROM vacp_all WHERE LOWER(iata) = {exact} OR {lower_like("name", value)} OR {lower_like("city", value)}'
        ') SELECT *, COUNT(*) OVER () AS __total_count FROM candidates ORDER BY __rank, iata LIMIT 1'
    )
    rows = await runtime.rows(AIRPORTS_REF, sql, max_rows=2)
    if not rows:
        raise ValueError(f'No airport found for {airport!r}')
    row = dict(rows[0])
    row.pop('__total_count', None)
    row.pop('__rank', None)
    return row


async def _airport_table(runtime: PlainMcpRuntime) -> str:
    snapshot = await runtime.state()
    entry = runtime.state_entry(snapshot, AIRPORTS_REF)
    table = entry.get('tableName')
    if not isinstance(table, str) or not table:
        raise RuntimeError('Airport metadata is not available')
    await runtime.sql(AIRPORTS_REF, 'SELECT 1 FROM vacp_all LIMIT 1', max_rows=1)
    return quote_table_ref(table)


def _route_filter(runtime: PlainMcpRuntime) -> JsonDict:
    return as_dict(runtime.recall('airports.route_filter'))


def _selected_airport(runtime: PlainMcpRuntime) -> JsonDict:
    return as_dict(runtime.recall('airports.selected_airport'))


async def _flight_state(runtime: PlainMcpRuntime) -> JsonDict:
    snapshot = await runtime.state()
    selected = runtime.state_entry(snapshot, ORG_REF)
    return {
        'selectedAirport': _airport_summary(selected.get('value'), _selected_airport(runtime)),
        'routeFilter': _route_filter(runtime),
        'hover': _hover_summary(runtime.recall('airports.hover')),
    }


def make_get_flight_map_state(runtime: PlainMcpRuntime) -> ToolCallable:
    async def get_flight_map_state() -> JsonDict:
        """Return the current airport selection, route filter, and hover state."""
        return await _flight_state(runtime)

    return get_flight_map_state


def make_select_airport(runtime: PlainMcpRuntime) -> ToolCallable:
    async def select_airport(
        airport: Annotated[str, Field(description='Airport IATA code or name.')],
    ) -> JsonDict:
        """Select one origin airport on the flight map."""
        row = await _airport_lookup(runtime, airport)
        code = str(row.get('iata') or airport).upper()
        await runtime.execute_contract('vega_lite.set_selection', {'ref': ORG_REF, 'value': {'origin': code}})
        runtime.remember('airports.selected_airport', row)
        state = await _flight_state(runtime)
        state['selectedAirport'] = _airport_summary(None, row)
        return action_response('select_airport', state, details={'airport': state['selectedAirport']})

    return select_airport


def make_filter_routes(runtime: PlainMcpRuntime) -> ToolCallable:
    async def filter_routes(
        origin: Annotated[str | None, Field(description='Origin IATA code.')] = None,
        destination: Annotated[str | None, Field(description='Destination IATA code.')] = None,
        min_count: Annotated[int | None, Field(ge=0)] = None,
    ) -> JsonDict:
        """Set the route filter used by flight map query tools."""
        route_filter = {
            key: value
            for key, value in {'origin': origin, 'destination': destination, 'minCount': min_count}.items()
            if value is not None and value != ''
        }
        runtime.remember('airports.route_filter', route_filter)
        if origin:
            await runtime.execute_contract(
                'vega_lite.set_selection', {'ref': ORG_REF, 'value': {'origin': origin.upper()}}
            )
        state = await _flight_state(runtime)
        state['routeFilter'] = route_filter
        return action_response('filter_routes', state, details=route_filter)

    return filter_routes


def make_hover_route(runtime: PlainMcpRuntime) -> ToolCallable:
    async def hover_route(
        origin: Annotated[str, Field(description='Origin IATA code.')],
        destination: Annotated[str, Field(description='Destination IATA code.')],
    ) -> JsonDict:
        """Show a hover focus for one flight route."""
        sql = select_with_total(
            columns=_ROUTE_COLUMNS,
            where=[string_equals('origin', origin), string_equals('destination', destination)],
            order_by='count',
            direction='desc',
            limit=1,
        )
        rows = await runtime.rows(ROUTES_REF, sql, max_rows=2)
        if not rows:
            raise ValueError(f'No route found from {origin!r} to {destination!r}')
        row = dict(rows[0])
        row.pop('__total_count', None)
        await runtime.execute_contract(
            'vega_lite.set_selection', {'ref': ORG_REF, 'value': {'origin': str(row.get('origin'))}}
        )
        await runtime.execute_contract(
            'vega_lite.hover_tooltip',
            {'fields': {'origin': row.get('origin'), 'destination': row.get('destination')}, 'value': row},
        )
        hover = {'origin': row.get('origin'), 'destination': row.get('destination'), 'row': row}
        runtime.remember('airports.hover', hover)
        state = await _flight_state(runtime)
        state['hover'] = _hover_summary(hover)
        return action_response('hover_route', state, details={'row': row})

    return hover_route


def make_query_flight_data(runtime: PlainMcpRuntime) -> ToolCallable:
    async def query_flight_data(
        origin: str | None = None,
        destination: str | None = None,
        origin_state: str | None = None,
        destination_state: str | None = None,
        min_count: int | None = None,
        max_count: int | None = None,
        limit: Annotated[int, Field(ge=1, le=500)] = 25,
    ) -> JsonDict:
        """Query flight route rows and join airport metadata."""
        saved_filter = _route_filter(runtime)
        selected_airport = _selected_airport(runtime)
        origin_value = (
            origin
            or (str(saved_filter.get('origin')) if saved_filter.get('origin') else None)
            or (str(selected_airport.get('iata')) if selected_airport.get('iata') else None)
        )
        destination_value = destination or (
            str(saved_filter.get('destination')) if saved_filter.get('destination') else None
        )
        min_count_value = min_count if min_count is not None else saved_filter.get('minCount')

        clauses: list[str] = []
        if origin_value:
            clauses.append(string_equals('r.origin', origin_value))
        if destination_value:
            clauses.append(string_equals('r.destination', destination_value))
        clauses.extend(
            numeric_range(
                'r.count',
                min_count_value if isinstance(min_count_value, int) else None,
                max_count,
            )
        )
        if origin_state:
            clauses.append(string_equals('oa.state', origin_state))
        if destination_state:
            clauses.append(string_equals('da.state', destination_state))
        airport_table = await _airport_table(runtime)
        limit_value = clean_limit(limit)
        sql = (
            'WITH routes AS ('
            'SELECT origin, destination, TRY_CAST(count AS INTEGER) AS count FROM vacp_all'
            ') '
            'SELECT r.origin, r.destination, r.count, '
            'oa.name AS origin_airport_name, oa.city AS origin_city, oa.state AS origin_state, '
            'TRY_CAST(oa.latitude AS DOUBLE) AS origin_latitude, '
            'TRY_CAST(oa.longitude AS DOUBLE) AS origin_longitude, '
            'da.name AS destination_airport_name, da.city AS destination_city, da.state AS destination_state, '
            'TRY_CAST(da.latitude AS DOUBLE) AS destination_latitude, '
            'TRY_CAST(da.longitude AS DOUBLE) AS destination_longitude '
            'FROM routes r '
            f'LEFT JOIN {airport_table} oa ON oa.iata = r.origin '
            f'LEFT JOIN {airport_table} da ON da.iata = r.destination'
            f'{where_clause(clauses)} ORDER BY r.count DESC LIMIT {limit_value}'
        )
        filters = {
            'origin': origin_value,
            'destination': destination_value,
            'originState': origin_state,
            'destinationState': destination_state,
            'minCount': min_count_value,
            'maxCount': max_count,
            'limit': limit,
        }
        result = await runtime.sql(ROUTES_REF, sql, max_rows=limit_value)
        return data_response(result, filters, note='Flight routes matching the requested map filters.')

    return query_flight_data


SPEC = UseCaseSpec(
    id='UC4',
    route='/vega-lite/#airports',
    title='Airport Flight Map',
    tools=(
        ToolSpec(
            'get_flight_map_state',
            'Get Flight Map State',
            'Read the current airport selection, route filter, hover, and data summary.',
            make_get_flight_map_state,
            True,
        ),
        ToolSpec('select_airport', 'Select Airport', 'Select an airport by IATA code or name.', make_select_airport),
        ToolSpec('filter_routes', 'Filter Routes', 'Set the route filter used by map queries.', make_filter_routes),
        ToolSpec('hover_route', 'Hover Route', 'Show a hover focus for one route.', make_hover_route),
        ToolSpec(
            'query_flight_data',
            'Query Flight Data',
            'Filter flight routes and join airport metadata.',
            make_query_flight_data,
            True,
        ),
    ),
)
