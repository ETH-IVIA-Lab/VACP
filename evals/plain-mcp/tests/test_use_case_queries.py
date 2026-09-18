from __future__ import annotations

from typing import cast

import pytest
from plain_mcp.runtime import JsonDict, PlainMcpRuntime, as_dict
from plain_mcp.use_cases.airports import (
    AIRPORTS_REF,
    ORG_REF,
    ROUTES_REF,
    make_filter_routes,
    make_hover_route,
    make_query_flight_data,
)
from plain_mcp.use_cases.athletes import DATA_REF as ATHLETES_REF
from plain_mcp.use_cases.athletes import make_brush_scatterplot, make_query_athlete_data
from plain_mcp.use_cases.cars import DATA_REF as CARS_REF
from plain_mcp.use_cases.cars import make_query_cars_data
from plain_mcp.use_cases.global_development import DATA_REF as GAPMINDER_REF
from plain_mcp.use_cases.global_development import YEAR_REF, make_hover_country, make_query_gapminder_data
from plain_mcp.use_cases.seattle_weather import DATA_REF, make_hover_weather_point, make_query_weather_data


class _SqlRuntime:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, int]] = []
        self.local: dict[str, object] = {}

    def remember(self, key: str, value: object | None) -> None:
        if value is None:
            self.local.pop(key, None)
        else:
            self.local[key] = value

    def recall(self, key: str) -> object | None:
        return self.local.get(key)

    async def state(self, request: object | None = None) -> JsonDict:  # noqa: ARG002
        return {'state': {YEAR_REF: {'value': 2000}}}

    def state_entry(self, snapshot: JsonDict, ref: str) -> JsonDict:
        state = as_dict(snapshot.get('state'))
        return as_dict(state.get(ref))

    async def sql(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> JsonDict:
        self.calls.append((handle_ref, sql, max_rows))
        return {'rows': [{'weather': 'rain', 'count': 3}]}

    async def browser_value(self, expression: str, arg: object | None = None) -> object:  # noqa: ARG002
        data = as_dict(arg)
        start = str(data.get('start'))
        end = str(data.get('end'))
        start_has_year = start.count('-') == 2
        end_has_year = end.count('-') == 2
        return {
            'startDateMs': 1_451_523_200_000,
            'endDateMs': 1_451_523_200_000,
            'startMonthdateMs': 1_356_912_000_000,
            'endMonthdateMs': 1_356_912_000_000,
            'startDateText': start,
            'endDateText': end,
            'startHasYear': start_has_year,
            'endHasYear': end_has_year,
        }


class _StateRuntime:
    def __init__(self) -> None:
        self.local: dict[str, object] = {}
        self.calls: list[tuple[str, JsonDict | None]] = []

    def remember(self, key: str, value: object | None) -> None:
        if value is None:
            self.local.pop(key, None)
        else:
            self.local[key] = value

    def recall(self, key: str) -> object | None:
        return self.local.get(key)

    async def state(self, request: object | None = None) -> JsonDict:  # noqa: ARG002
        return {'state': {}}

    def state_entry(self, snapshot: JsonDict, ref: str) -> JsonDict:  # noqa: ARG002
        return {}

    async def execute(self, name: str, params: JsonDict | None = None) -> object | None:
        self.calls.append((name, params))
        return {'ok': True}


class _WeatherPointRuntime(_StateRuntime):
    def __init__(self) -> None:
        super().__init__()
        self.row_calls: list[tuple[str, str, int]] = []

    async def browser_value(self, expression: str, arg: object | None = None) -> object:  # noqa: ARG002
        data = as_dict(arg)
        date = str(data.get('start'))
        return {
            'startDateMs': 1_451_523_200_000,
            'endDateMs': 1_451_523_200_000,
            'startMonthdateMs': 1_356_912_000_000,
            'endMonthdateMs': 1_356_912_000_000,
            'startDateText': date,
            'endDateText': date,
            'startHasYear': date.count('-') == 2,
            'endHasYear': date.count('-') == 2,
        }

    async def rows(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> list[JsonDict]:
        self.row_calls.append((handle_ref, sql, max_rows))
        return [{'date': '2015-12-31', 'weather': 'rain'}]


class _AirportQueryRuntime(_StateRuntime):
    def __init__(self) -> None:
        super().__init__()
        self.sql_calls: list[tuple[str, str, int]] = []

    async def state(self, request: object | None = None) -> JsonDict:  # noqa: ARG002
        return {'state': {AIRPORTS_REF: {'tableName': 'airports_table'}}}

    def state_entry(self, snapshot: JsonDict, ref: str) -> JsonDict:
        state = as_dict(snapshot.get('state'))
        return as_dict(state.get(ref))

    async def sql(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> JsonDict:
        self.sql_calls.append((handle_ref, sql, max_rows))
        return {'rows': []}


class _RouteHoverRuntime(_StateRuntime):
    async def rows(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> list[JsonDict]:  # noqa: ARG002
        return [{'origin': 'SFO', 'destination': 'LAX', 'count': 42}]


class _GapminderHoverRuntime(_StateRuntime):
    async def state(self, request: object | None = None) -> JsonDict:  # noqa: ARG002
        return {'state': {YEAR_REF: {'value': 1990}}}

    def state_entry(self, snapshot: JsonDict, ref: str) -> JsonDict:
        state = as_dict(snapshot.get('state'))
        return as_dict(state.get(ref))

    async def rows(self, handle_ref: str, sql: str, *, max_rows: int = 500) -> list[JsonDict]:  # noqa: ARG002
        return [{'country': 'France', 'year': 2000, 'fertility': 1.9}]


@pytest.mark.asyncio
async def test_weather_aggregate_query_reports_all_applied_filters() -> None:
    runtime = _SqlRuntime()
    query_weather_data = make_query_weather_data(cast(PlainMcpRuntime, runtime))

    result = await query_weather_data(
        category='rain',
        min_temp_max=10,
        aggregate='count_by_weather',
        limit=10,
    )

    assert result['filters'] == {
        'category': 'rain',
        'minTempMax': 10,
        'aggregate': 'count_by_weather',
        'limit': 10,
    }
    assert result['columns'] == ['weather', 'count']
    assert result['rowCount'] == 1
    assert runtime.calls[0][0] == DATA_REF
    assert runtime.calls[0][2] == 10


@pytest.mark.asyncio
async def test_weather_query_uses_full_date_when_year_is_provided() -> None:
    runtime = _SqlRuntime()
    query_weather_data = make_query_weather_data(cast(PlainMcpRuntime, runtime))

    await query_weather_data(start_date='2015-12-31', end_date='2015-12-31')

    sql = runtime.calls[0][1]
    assert 'CAST(date AS VARCHAR) BETWEEN' in sql
    assert "'2015-12-31'" in sql
    assert 'monthdate_date BETWEEN' not in sql


@pytest.mark.asyncio
async def test_weather_query_uses_remembered_brush_when_dates_are_omitted() -> None:
    runtime = _SqlRuntime()
    runtime.remember('seattle_weather.brush', {'startDate': '02-01', 'endDate': '04-30'})
    query_weather_data = make_query_weather_data(cast(PlainMcpRuntime, runtime))

    result = await query_weather_data(aggregate='count_by_weather')

    sql = runtime.calls[0][1]
    assert 'monthdate_date BETWEEN' in sql
    assert as_dict(result.get('filters')) == {
        'startDate': '02-01',
        'endDate': '04-30',
        'aggregate': 'count_by_weather',
        'limit': 25,
    }


@pytest.mark.asyncio
async def test_weather_hover_uses_full_date_when_year_is_provided() -> None:
    runtime = _WeatherPointRuntime()
    hover_weather_point = make_hover_weather_point(cast(PlainMcpRuntime, runtime))

    await hover_weather_point(date='2015-12-31')

    sql = runtime.row_calls[0][1]
    assert 'CAST(date AS VARCHAR)' in sql
    assert "'2015-12-31'" in sql
    assert 'monthdate_date =' not in sql


@pytest.mark.asyncio
async def test_gapminder_query_derives_region_name_from_cluster() -> None:
    runtime = _SqlRuntime()
    query_gapminder_data = make_query_gapminder_data(cast(PlainMcpRuntime, runtime))

    await query_gapminder_data(year=2000, limit=5)

    handle_ref, sql, max_rows = runtime.calls[0]
    assert handle_ref == GAPMINDER_REF
    assert 'AS region_name' in sql
    assert 'SELECT country, region_name' not in sql
    assert max_rows == 5


@pytest.mark.asyncio
async def test_gapminder_query_uses_current_year_when_year_is_omitted() -> None:
    runtime = _SqlRuntime()
    query_gapminder_data = make_query_gapminder_data(cast(PlainMcpRuntime, runtime))

    result = await query_gapminder_data(limit=5)

    sql = runtime.calls[0][1]
    assert 'year = 2000' in sql
    assert as_dict(result.get('filters')).get('year') == 2000


@pytest.mark.asyncio
async def test_gapminder_hover_sets_explicit_year_before_hovering() -> None:
    runtime = _GapminderHoverRuntime()
    hover_country = make_hover_country(cast(PlainMcpRuntime, runtime))

    await hover_country(country='France', year=2000)

    assert runtime.calls[0] == ('vega_lite.set_param', {'ref': YEAR_REF, 'value': 2000})
    assert runtime.calls[1][0] == 'vega_lite.hover_tooltip'


@pytest.mark.asyncio
async def test_route_filter_preserves_zero_min_count() -> None:
    runtime = _StateRuntime()
    filter_routes = make_filter_routes(cast(PlainMcpRuntime, runtime))

    result = await filter_routes(min_count=0)

    assert result['status'] == 'ok'
    assert as_dict(as_dict(result.get('state')).get('routeFilter')) == {'minCount': 0}


@pytest.mark.asyncio
async def test_flight_query_uses_selected_airport_as_origin() -> None:
    runtime = _AirportQueryRuntime()
    runtime.remember('airports.selected_airport', {'iata': 'SFO'})
    query_flight_data = make_query_flight_data(cast(PlainMcpRuntime, runtime))

    result = await query_flight_data()

    assert as_dict(result.get('filters')).get('origin') == 'SFO'
    assert runtime.sql_calls[0] == (AIRPORTS_REF, 'SELECT 1 FROM vacp_all LIMIT 1', 1)
    handle_ref, sql, _max_rows = runtime.sql_calls[1]
    assert handle_ref == ROUTES_REF
    assert "LOWER(r.origin) = 'sfo'" in sql


@pytest.mark.asyncio
async def test_route_hover_selects_origin_before_hovering() -> None:
    runtime = _RouteHoverRuntime()
    hover_route = make_hover_route(cast(PlainMcpRuntime, runtime))

    await hover_route(origin='SFO', destination='LAX')

    assert runtime.calls[0] == ('vega_lite.set_selection', {'ref': ORG_REF, 'value': {'origin': 'SFO'}})
    assert runtime.calls[1][0] == 'vega_lite.hover_tooltip'


@pytest.mark.asyncio
async def test_athlete_brush_defaults_to_meter_height_domain() -> None:
    runtime = _StateRuntime()
    brush_scatterplot = make_brush_scatterplot(cast(PlainMcpRuntime, runtime))

    await brush_scatterplot(min_weight=100, max_weight=120)

    params = as_dict(runtime.calls[0][1])
    assert params['x0'] == 100
    assert params['x1'] == 120
    assert params['y0'] == 1.2
    assert params['y1'] == 2.3


@pytest.mark.asyncio
async def test_cars_query_reads_selection_filtered_handle() -> None:
    runtime = _SqlRuntime()
    query_cars_data = make_query_cars_data(cast(PlainMcpRuntime, runtime))

    await query_cars_data(dimension='Weight', min_value=2000, max_value=3000)

    handle_ref, sql, _max_rows = runtime.calls[0]
    assert handle_ref == CARS_REF
    assert 'FROM vacp_handle' in sql


@pytest.mark.asyncio
async def test_athlete_query_reads_selection_filtered_handle() -> None:
    runtime = _SqlRuntime()
    query_athlete_data = make_query_athlete_data(cast(PlainMcpRuntime, runtime))

    await query_athlete_data(sport='judo')

    handle_ref, sql, _max_rows = runtime.calls[0]
    assert handle_ref == ATHLETES_REF
    assert 'FROM vacp_handle' in sql
