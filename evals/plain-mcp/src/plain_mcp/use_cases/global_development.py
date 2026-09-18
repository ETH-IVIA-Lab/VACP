from __future__ import annotations

from typing import Annotated, Literal, cast

from pydantic import Field

from plain_mcp.protocol import ToolCallable, ToolSpec, UseCaseSpec
from plain_mcp.runtime import JsonDict, PlainMcpRuntime
from plain_mcp.sql import (
    SortDirection,
    action_response,
    data_response,
    lower_like,
    numeric_range,
    select_query,
    select_with_total,
    string_equals,
)

YEAR_REF = 'vacp://vacp-examples/vega-lite/global-development/global-development/param/current_year'
VIEW_REF = 'vacp://vacp-examples/vega-lite/global-development/global-development/param/view'
DATA_REF = 'vacp://vacp-examples/vega-lite/global-development/global-development/data/main'

GapminderSortColumn = Literal['life_expect', 'fertility', 'pop', 'country', 'year']

_REGION_NAME = (
    "CASE WHEN cluster = 0 THEN 'South Asia' "
    "WHEN cluster = 1 THEN 'Europe & Central Asia' "
    "WHEN cluster = 2 THEN 'Sub-Saharan Africa' "
    "WHEN cluster = 3 THEN 'America' "
    "WHEN cluster = 4 THEN 'East Asia & Pacific' "
    "ELSE 'Middle East & North Africa' END AS region_name"
)
_COLUMNS = ('country', _REGION_NAME, 'year', 'fertility', 'life_expect', 'pop', 'cluster')


def _domain(value: object, *keys: str) -> list[object] | None:
    if not isinstance(value, dict):
        return None
    typed = cast(dict[str, object], value)
    for key in keys:
        raw = typed.get(key)
        if isinstance(raw, list) and len(raw) == 2:
            return list(raw)
    return None


def _zoom_summary(value: object, fallback: object | None) -> JsonDict:
    summary: JsonDict = {}
    source = value if isinstance(value, dict) and value else fallback
    fertility = _domain(source, 'fertility', 'x')
    life_expectancy = _domain(source, 'life_expect', 'lifeExpectancy', 'y')
    if fertility:
        summary['fertility'] = fertility
    if life_expectancy:
        summary['lifeExpectancy'] = life_expectancy
    return summary


def _hover_summary(value: object | None) -> JsonDict | None:
    if not isinstance(value, dict):
        return None
    typed = cast(dict[str, object], value)
    summary = {key: typed.get(key) for key in ('country', 'year') if typed.get(key) is not None}
    return summary or None


def _range_with_default(
    minimum: float | None,
    maximum: float | None,
    *,
    default_min: float,
    default_max: float,
    scale_factor: float | None,
) -> list[float]:
    lo = default_min if minimum is None else minimum
    hi = default_max if maximum is None else maximum
    if scale_factor is None:
        return [lo, hi]
    center = (lo + hi) / 2
    radius = (hi - lo) / (2 * scale_factor)
    return [center - radius, center + radius]


async def _bubble_state(runtime: PlainMcpRuntime) -> JsonDict:
    snapshot = await runtime.state()
    year = runtime.state_entry(snapshot, YEAR_REF)
    zoom = runtime.state_entry(snapshot, VIEW_REF)
    return {
        'year': year.get('value'),
        'zoom': _zoom_summary(zoom.get('value'), runtime.recall('global_development.zoom')),
        'hover': _hover_summary(runtime.recall('global_development.hover')),
    }


async def _current_year(runtime: PlainMcpRuntime) -> int:
    snapshot = await runtime.state()
    current_year = runtime.state_entry(snapshot, YEAR_REF).get('value')
    return current_year if isinstance(current_year, int) else 1990


def make_get_bubble_chart_state(runtime: PlainMcpRuntime) -> ToolCallable:
    async def get_bubble_chart_state() -> JsonDict:
        """Return the current bubble chart year, zoom, hover, and data state."""
        return await _bubble_state(runtime)

    return get_bubble_chart_state


def make_set_year(runtime: PlainMcpRuntime) -> ToolCallable:
    async def set_year(year: Annotated[int, Field(ge=1955, le=2005, multiple_of=5)]) -> JsonDict:
        """Set the global-development year slider."""
        await runtime.execute_contract('vega_lite.set_param', {'ref': YEAR_REF, 'value': year})
        return action_response('set_year', await _bubble_state(runtime), details={'year': year})

    return set_year


def make_zoom_chart(runtime: PlainMcpRuntime) -> ToolCallable:
    async def zoom_chart(
        x_min: Annotated[float | None, Field(description='Minimum fertility domain value.')] = None,
        x_max: Annotated[float | None, Field(description='Maximum fertility domain value.')] = None,
        y_min: Annotated[float | None, Field(description='Minimum life expectancy domain value.')] = None,
        y_max: Annotated[float | None, Field(description='Maximum life expectancy domain value.')] = None,
        scale_factor: Annotated[float | None, Field(gt=1, le=4, description='Optional visual zoom factor.')] = None,
    ) -> JsonDict:
        """Set the bubble chart zoom domain."""
        if all(value is None for value in (x_min, x_max, y_min, y_max, scale_factor)):
            raise ValueError('Provide a domain bound or scale_factor')
        x_range = _range_with_default(x_min, x_max, default_min=0, default_max=9, scale_factor=scale_factor)
        y_range = _range_with_default(y_min, y_max, default_min=20, default_max=90, scale_factor=scale_factor)
        value = {'fertility': x_range, 'life_expect': y_range, 'x': x_range, 'y': y_range}
        await runtime.execute_contract('vega_lite.set_selection', {'ref': VIEW_REF, 'value': value})
        runtime.remember('global_development.zoom', {'fertility': x_range, 'lifeExpectancy': y_range})
        state = await _bubble_state(runtime)
        if not state.get('zoom'):
            state['zoom'] = runtime.recall('global_development.zoom') or {}
        return action_response('zoom_chart', state, details={'fertility': x_range, 'lifeExpectancy': y_range})

    return zoom_chart


def make_hover_country(runtime: PlainMcpRuntime) -> ToolCallable:
    async def hover_country(
        country: Annotated[str, Field(min_length=1)],
        year: Annotated[int | None, Field(ge=1955, le=2005, multiple_of=5)] = None,
    ) -> JsonDict:
        """Show a hover focus for one country at a chosen year."""
        target_year = year if year is not None else await _current_year(runtime)
        sql = select_with_total(
            columns=_COLUMNS,
            where=[string_equals('country', country), f'year = {target_year}'],
            order_by='pop',
            direction='desc',
            limit=1,
        )
        rows = await runtime.rows(DATA_REF, sql, max_rows=2)
        if not rows:
            raise ValueError(f'No Gapminder row found for {country!r} in {target_year}')
        row = dict(rows[0])
        row.pop('__total_count', None)
        if year is not None:
            await runtime.execute_contract('vega_lite.set_param', {'ref': YEAR_REF, 'value': target_year})
        await runtime.execute_contract(
            'vega_lite.hover_tooltip',
            {'fields': {'country': row.get('country'), 'year': row.get('year')}, 'value': row},
        )
        hover = {'country': row.get('country'), 'year': row.get('year'), 'row': row}
        runtime.remember('global_development.hover', hover)
        state = await _bubble_state(runtime)
        state['hover'] = _hover_summary(hover)
        return action_response('hover_country', state, details={'row': row})

    return hover_country


def make_query_gapminder_data(runtime: PlainMcpRuntime) -> ToolCallable:
    async def query_gapminder_data(
        year: Annotated[int | None, Field(ge=1955, le=2005, multiple_of=5)] = None,
        country: str | None = None,
        min_fertility: float | None = None,
        max_fertility: float | None = None,
        min_life_expectancy: float | None = None,
        max_life_expectancy: float | None = None,
        min_population: float | None = None,
        max_population: float | None = None,
        sort_by: GapminderSortColumn | None = None,
        sort_direction: SortDirection = 'desc',
        limit: Annotated[int, Field(ge=1, le=500)] = 25,
    ) -> JsonDict:
        """Query the Gapminder rows behind the bubble chart."""
        year_value = year if year is not None else await _current_year(runtime)
        clauses: list[str] = []
        clauses.append(f'year = {year_value}')
        if country:
            clauses.append(lower_like('country', country))
        clauses.extend(numeric_range('fertility', min_fertility, max_fertility))
        clauses.extend(numeric_range('life_expect', min_life_expectancy, max_life_expectancy))
        clauses.extend(numeric_range('pop', min_population, max_population))
        sql = select_query(
            columns=_COLUMNS,
            where=clauses,
            order_by=sort_by or 'pop',
            direction=sort_direction,
            limit=limit,
        )
        result = await runtime.sql(DATA_REF, sql, max_rows=limit)
        filters = {
            'year': year_value,
            'country': country,
            'minFertility': min_fertility,
            'maxFertility': max_fertility,
            'minLifeExpectancy': min_life_expectancy,
            'maxLifeExpectancy': max_life_expectancy,
            'minPopulation': min_population,
            'maxPopulation': max_population,
            'sortBy': sort_by,
            'sortDirection': sort_direction,
            'limit': limit,
        }
        return data_response(result, filters, note='Gapminder rows matching the requested chart filters.')

    return query_gapminder_data


SPEC = UseCaseSpec(
    id='UC1',
    route='/vega-lite/#global-development',
    title='Global Development Bubble Chart',
    tools=(
        ToolSpec(
            'get_bubble_chart_state',
            'Get Bubble Chart State',
            'Read the current year, zoom, hover, and data summary.',
            make_get_bubble_chart_state,
            True,
        ),
        ToolSpec('set_year', 'Set Year', 'Set the bubble chart year slider.', make_set_year),
        ToolSpec('zoom_chart', 'Zoom Chart', 'Set the bubble chart zoom domain.', make_zoom_chart),
        ToolSpec('hover_country', 'Hover Country', 'Show a hover focus for a country.', make_hover_country),
        ToolSpec(
            'query_gapminder_data',
            'Query Gapminder Data',
            'Filter and sort the Gapminder rows behind the chart.',
            make_query_gapminder_data,
            True,
        ),
    ),
)
