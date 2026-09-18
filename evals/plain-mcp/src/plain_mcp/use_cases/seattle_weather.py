from __future__ import annotations

from typing import Annotated, Literal, TypedDict, cast

from pydantic import Field

from plain_mcp.protocol import ToolCallable, ToolSpec, UseCaseSpec
from plain_mcp.runtime import JsonDict, PlainMcpRuntime, as_dict
from plain_mcp.sql import (
    action_response,
    clean_limit,
    data_response,
    numeric_range,
    sql_literal,
    string_equals,
    where_clause,
)

CLICK_REF = 'vacp://vacp-examples/vega-lite/seattle-weather/seattle-weather/param/click'
BRUSH_REF = 'vacp://vacp-examples/vega-lite/seattle-weather/seattle-weather/param/brush'
DATA_REF = 'vacp://vacp-examples/vega-lite/seattle-weather/seattle-weather/data/main'

WeatherCategory = Literal['sun', 'fog', 'drizzle', 'rain', 'snow']
WeatherAggregate = Literal['none', 'count_by_weather', 'extreme_temp_max_by_weather']


class DateBounds(TypedDict):
    startDateMs: int
    endDateMs: int
    startMonthdateMs: int
    endMonthdateMs: int
    startDateText: str
    endDateText: str
    startHasYear: bool
    endHasYear: bool


def _selected_category(value: object, remembered: object | None) -> object | None:
    if isinstance(remembered, str) and remembered:
        return remembered
    if isinstance(value, dict):
        typed = cast(dict[str, object], value)
        category = typed.get('weather')
        if isinstance(category, str) and category:
            return category
    return None


def _date_brush(value: object, remembered: object | None) -> JsonDict:
    if isinstance(remembered, dict):
        typed_remembered = cast(dict[str, object], remembered)
        start = typed_remembered.get('startDate')
        end = typed_remembered.get('endDate')
        if start or end:
            return {'startDate': start, 'endDate': end}
    if not isinstance(value, dict):
        return {}
    typed = cast(dict[str, object], value)
    raw_range = typed.get('date') or typed.get('monthdate_date') or typed.get('x')
    if isinstance(raw_range, list) and len(raw_range) == 2:
        return {'range': raw_range}
    return {}


def _hover_summary(value: object | None) -> JsonDict | None:
    if not isinstance(value, dict):
        return None
    typed = cast(dict[str, object], value)
    summary = {key: typed.get(key) for key in ('date', 'weather') if typed.get(key) is not None}
    return summary or None


async def _date_bounds(runtime: PlainMcpRuntime, start: str, end: str) -> DateBounds:
    result = await runtime.browser_value(
        """
        ({ start, end }) => {
          const parse = (value) => {
            const text = String(value ?? '').trim();
            const full = text.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);
            const short = text.match(/^(\\d{1,2})-(\\d{1,2})$/);
            if (!full && !short) throw new Error('Expected YYYY-MM-DD or MM-DD');
            const year = full ? Number(full[1]) : 2012;
            const month = Number(full ? full[2] : short[1]);
            const day = Number(full ? full[3] : short[2]);
            const dateText = [
              String(year).padStart(4, '0'),
              String(month).padStart(2, '0'),
              String(day).padStart(2, '0'),
            ].join('-');
            return {
              dateMs: full ? Date.UTC(year, month - 1, day) : new Date(year, month - 1, day).getTime(),
              monthdateMs: new Date(2012, month - 1, day).getTime(),
              dateText,
              hasYear: Boolean(full),
            };
          };
          const a = parse(start);
          const b = parse(end);
          const dateStart = a.dateMs <= b.dateMs ? a : b;
          const dateEnd = a.dateMs <= b.dateMs ? b : a;
          return {
            startDateMs: Math.min(a.dateMs, b.dateMs),
            endDateMs: Math.max(a.dateMs, b.dateMs),
            startMonthdateMs: Math.min(a.monthdateMs, b.monthdateMs),
            endMonthdateMs: Math.max(a.monthdateMs, b.monthdateMs),
            startDateText: dateStart.dateText,
            endDateText: dateEnd.dateText,
            startHasYear: dateStart.hasYear,
            endHasYear: dateEnd.hasYear,
          };
        }
        """,
        {'start': start, 'end': end},
    )
    if not isinstance(result, dict):
        raise ValueError('Could not parse date range')
    raw = cast(dict[str, object], result)

    def number(key: str) -> int:
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError('Could not parse date range')
        return int(value)

    def text(key: str) -> str:
        value = raw.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError('Could not parse date range')
        return value

    return {
        'startDateMs': number('startDateMs'),
        'endDateMs': number('endDateMs'),
        'startMonthdateMs': number('startMonthdateMs'),
        'endMonthdateMs': number('endMonthdateMs'),
        'startDateText': text('startDateText'),
        'endDateText': text('endDateText'),
        'startHasYear': bool(raw.get('startHasYear')),
        'endHasYear': bool(raw.get('endHasYear')),
    }


def _date_point_clause(bounds: DateBounds) -> str:
    if bounds['startHasYear']:
        return (
            f'(CAST(date AS VARCHAR) = {sql_literal(bounds["startDateText"])} '
            f'OR TRY_CAST(date AS BIGINT) = {bounds["startDateMs"]})'
        )
    return f'monthdate_date = {bounds["startMonthdateMs"]}'


def _date_range_clause(bounds: DateBounds) -> str:
    if bounds['startHasYear'] and bounds['endHasYear']:
        return (
            f'((CAST(date AS VARCHAR) BETWEEN {sql_literal(bounds["startDateText"])} '
            f'AND {sql_literal(bounds["endDateText"])}) OR '
            f'(TRY_CAST(date AS BIGINT) BETWEEN {bounds["startDateMs"]} AND {bounds["endDateMs"]}))'
        )
    return f'monthdate_date BETWEEN {bounds["startMonthdateMs"]} AND {bounds["endMonthdateMs"]}'


async def _weather_state(runtime: PlainMcpRuntime) -> JsonDict:
    snapshot = await runtime.state()
    category = runtime.state_entry(snapshot, CLICK_REF)
    brush = runtime.state_entry(snapshot, BRUSH_REF)
    return {
        'category': _selected_category(category.get('value'), runtime.recall('seattle_weather.category')),
        'dateBrush': _date_brush(brush.get('value'), runtime.recall('seattle_weather.brush')),
        'hover': _hover_summary(runtime.recall('seattle_weather.hover')),
    }


def make_get_weather_chart_state(runtime: PlainMcpRuntime) -> ToolCallable:
    async def get_weather_chart_state() -> JsonDict:
        """Return the current weather chart brush, category, and hover state."""
        return await _weather_state(runtime)

    return get_weather_chart_state


def make_brush_date_range(runtime: PlainMcpRuntime) -> ToolCallable:
    async def brush_date_range(
        start_date: Annotated[str, Field(description='Start date as YYYY-MM-DD or MM-DD.')],
        end_date: Annotated[str, Field(description='End date as YYYY-MM-DD or MM-DD.')],
    ) -> JsonDict:
        """Brush the Seattle weather chart by date range."""
        bounds = await _date_bounds(runtime, start_date, end_date)
        value = {
            'date': [bounds['startDateMs'], bounds['endDateMs']],
            'monthdate_date': [bounds['startMonthdateMs'], bounds['endMonthdateMs']],
            'x': [bounds['startMonthdateMs'], bounds['endMonthdateMs']],
        }
        await runtime.execute('vega_lite.set_selection', {'ref': BRUSH_REF, 'value': value})
        runtime.remember('seattle_weather.brush', {'startDate': start_date, 'endDate': end_date})
        return action_response(
            'brush_date_range',
            await _weather_state(runtime),
            details={'startDate': start_date, 'endDate': end_date},
        )

    return brush_date_range


def make_select_weather_category(runtime: PlainMcpRuntime) -> ToolCallable:
    async def select_weather_category(category: WeatherCategory) -> JsonDict:
        """Select one weather category in the bar legend."""
        await runtime.execute('vega_lite.set_selection', {'ref': CLICK_REF, 'value': {'weather': category}})
        runtime.remember('seattle_weather.category', category)
        return action_response('select_weather_category', await _weather_state(runtime), details={'category': category})

    return select_weather_category


def make_hover_weather_point(runtime: PlainMcpRuntime) -> ToolCallable:
    async def hover_weather_point(
        date: Annotated[str | None, Field(description='Date as YYYY-MM-DD or MM-DD.')] = None,
        category: WeatherCategory | None = None,
    ) -> JsonDict:
        """Show a hover focus for one weather observation."""
        clauses: list[str] = []
        if category:
            clauses.append(string_equals('weather', category))
        if date:
            bounds = await _date_bounds(runtime, date, date)
            clauses.append(_date_point_clause(bounds))
        sql = (
            'WITH normalized AS ('
            'SELECT date, monthdate_date, weather, TRY_CAST(temp_max AS DOUBLE) AS temp_max, '
            'TRY_CAST(temp_min AS DOUBLE) AS temp_min, TRY_CAST(precipitation AS DOUBLE) AS precipitation, '
            'TRY_CAST(wind AS DOUBLE) AS wind FROM vacp_all'
            f') SELECT *, COUNT(*) OVER () AS __total_count FROM normalized{where_clause(clauses)} '
            'ORDER BY date LIMIT 1'
        )
        rows = await runtime.rows(DATA_REF, sql, max_rows=2)
        if not rows:
            raise ValueError('No weather row matched the requested hover')
        row = dict(rows[0])
        row.pop('__total_count', None)
        await runtime.execute('vega_lite.hover_tooltip', {'fields': {'date': row.get('date')}, 'value': row})
        hover = {'date': row.get('date'), 'weather': row.get('weather'), 'row': row}
        runtime.remember('seattle_weather.hover', hover)
        state = await _weather_state(runtime)
        state['hover'] = _hover_summary(hover)
        return action_response('hover_weather_point', state, details={'row': row})

    return hover_weather_point


def make_query_weather_data(runtime: PlainMcpRuntime) -> ToolCallable:
    async def query_weather_data(
        category: WeatherCategory | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        min_temp_max: float | None = None,
        max_temp_max: float | None = None,
        aggregate: WeatherAggregate = 'none',
        limit: Annotated[int, Field(ge=1, le=500)] = 25,
    ) -> JsonDict:
        """Query the Seattle weather rows behind the chart."""
        saved_brush = as_dict(runtime.recall('seattle_weather.brush'))
        category_value = category or (
            str(runtime.recall('seattle_weather.category')) if runtime.recall('seattle_weather.category') else None
        )
        start_date_value = start_date
        end_date_value = end_date
        if start_date_value is None and end_date_value is None:
            saved_start = saved_brush.get('startDate')
            saved_end = saved_brush.get('endDate')
            start_date_value = str(saved_start) if saved_start else None
            end_date_value = str(saved_end) if saved_end else None

        clauses: list[str] = []
        if category_value:
            clauses.append(string_equals('weather', category_value))
        if start_date_value and end_date_value:
            bounds = await _date_bounds(runtime, start_date_value, end_date_value)
            clauses.append(_date_range_clause(bounds))
        elif start_date_value or end_date_value:
            date_value = start_date_value or end_date_value or ''
            bounds = await _date_bounds(runtime, date_value, date_value)
            clauses.append(_date_point_clause(bounds))
        clauses.extend(numeric_range('temp_max', min_temp_max, max_temp_max))

        normalized = (
            'WITH normalized AS ('
            'SELECT date, monthdate_date, weather, TRY_CAST(temp_max AS DOUBLE) AS temp_max, '
            'TRY_CAST(temp_min AS DOUBLE) AS temp_min, TRY_CAST(precipitation AS DOUBLE) AS precipitation, '
            'TRY_CAST(wind AS DOUBLE) AS wind FROM vacp_all)'
        )
        max_rows = clean_limit(limit)
        filters = {
            'category': category_value,
            'startDate': start_date_value,
            'endDate': end_date_value,
            'minTempMax': min_temp_max,
            'maxTempMax': max_temp_max,
            'aggregate': aggregate,
            'limit': limit,
        }
        if aggregate == 'count_by_weather':
            sql = (
                f'{normalized} SELECT weather, COUNT(*)::INTEGER AS count FROM normalized{where_clause(clauses)} '
                f'GROUP BY weather ORDER BY count DESC LIMIT {max_rows}'
            )
            result = await runtime.sql(DATA_REF, sql, max_rows=max_rows)
            return data_response(result, filters, note='Daily record counts grouped by weather category.')
        if aggregate == 'extreme_temp_max_by_weather':
            sql = (
                f'{normalized} SELECT weather, MAX(temp_max) AS max_temp_max FROM normalized{where_clause(clauses)} '
                f'GROUP BY weather ORDER BY max_temp_max DESC LIMIT {max_rows}'
            )
            result = await runtime.sql(DATA_REF, sql, max_rows=max_rows)
            return data_response(result, filters, note='Maximum high temperature grouped by weather category.')

        sql = (
            f'{normalized}, filtered AS (SELECT * FROM normalized{where_clause(clauses)}) '
            f'SELECT * FROM filtered ORDER BY date LIMIT {max_rows}'
        )
        result = await runtime.sql(DATA_REF, sql, max_rows=max_rows)
        return data_response(result, filters, note='Seattle weather rows matching the requested filters.')

    return query_weather_data


SPEC = UseCaseSpec(
    id='UC2',
    route='/vega-lite/#seattle-weather',
    title='Seattle Weather Chart',
    tools=(
        ToolSpec(
            'get_weather_chart_state',
            'Get Weather Chart State',
            'Read the current date brush, category, hover, and data summary.',
            make_get_weather_chart_state,
            True,
        ),
        ToolSpec('brush_date_range', 'Brush Date Range', 'Brush the chart by date range.', make_brush_date_range),
        ToolSpec(
            'select_weather_category',
            'Select Weather Category',
            'Select one weather category.',
            make_select_weather_category,
        ),
        ToolSpec(
            'hover_weather_point',
            'Hover Weather Point',
            'Show a hover focus for an observation.',
            make_hover_weather_point,
        ),
        ToolSpec(
            'query_weather_data',
            'Query Weather Data',
            'Filter or aggregate the Seattle weather rows.',
            make_query_weather_data,
            True,
        ),
    ),
)
