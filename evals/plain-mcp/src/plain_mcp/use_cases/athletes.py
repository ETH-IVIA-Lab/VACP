from __future__ import annotations

from typing import Annotated, Literal

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
    string_equals,
)

SPORT_REF = 'vacp://vacp-examples/vgplot/athletes/input/0'
GENDER_REF = 'vacp://vacp-examples/vgplot/athletes/input/1'
NAME_REF = 'vacp://vacp-examples/vgplot/athletes/input/2'
SCATTER_REF = 'vacp://vacp-examples/vgplot/athletes/plot-0/interactor/0'
TABLE_REF = 'vacp://vacp-examples/vgplot/athletes/table-0'
DATA_REF = 'vacp://vacp-examples/vgplot/athletes/data/main'

AthleteGender = Literal['all', 'female', 'male']
AthleteSortColumn = Literal['name', 'nationality', 'sex', 'height', 'weight', 'sport']

_COLUMNS = ('name', 'nationality', 'sex', 'height', 'weight', 'sport', 'gold', 'silver', 'bronze')


def _gender_value(gender: AthleteGender) -> str:
    return '' if gender == 'all' else gender


def _brush_summary(value: JsonDict) -> JsonDict:
    summary: JsonDict = {}
    for source, target in (
        ('x0', 'minWeight'),
        ('x1', 'maxWeight'),
        ('y0', 'minHeight'),
        ('y1', 'maxHeight'),
    ):
        if source in value:
            summary[target] = value[source]
    if summary:
        return summary
    return {key: value for key, value in value.items() if key not in {'kind', 'plotId'}}


async def _dashboard_state(runtime: PlainMcpRuntime) -> JsonDict:
    snapshot = await runtime.state()
    sport = runtime.state_entry(snapshot, SPORT_REF)
    gender = runtime.state_entry(snapshot, GENDER_REF)
    name = runtime.state_entry(snapshot, NAME_REF)
    brush = runtime.state_entry(snapshot, SCATTER_REF)
    table = runtime.state_entry(snapshot, TABLE_REF)
    return {
        'filters': {
            'sport': sport.get('value') or 'all',
            'gender': gender.get('value') or 'all',
            'name': name.get('value') or '',
        },
        'brush': _brush_summary(brush),
        'table': {
            'sortColumn': table.get('sortColumn'),
            'sortDirection': 'desc' if table.get('sortDesc') else 'asc',
            'offset': table.get('offset'),
            'limit': table.get('limit'),
        },
    }


def make_get_athlete_dashboard_state(runtime: PlainMcpRuntime) -> ToolCallable:
    async def get_athlete_dashboard_state() -> JsonDict:
        """Return the current athlete filters, brush, table, and data state."""
        return await _dashboard_state(runtime)

    return get_athlete_dashboard_state


def make_set_sport_filter(runtime: PlainMcpRuntime) -> ToolCallable:
    async def set_sport_filter(
        sport: Annotated[str, Field(description='Sport menu value, or all.')],
    ) -> JsonDict:
        """Set the athlete sport menu."""
        value = '' if sport.strip().lower() == 'all' else sport.strip().lower()
        await runtime.execute('vgplot.set_input_value', {'ref': SPORT_REF, 'value': value})
        return action_response('set_sport_filter', await _dashboard_state(runtime), details={'sport': sport})

    return set_sport_filter


def make_set_gender_filter(runtime: PlainMcpRuntime) -> ToolCallable:
    async def set_gender_filter(gender: AthleteGender) -> JsonDict:
        """Set the athlete sex menu."""
        await runtime.execute('vgplot.set_input_value', {'ref': GENDER_REF, 'value': _gender_value(gender)})
        return action_response('set_gender_filter', await _dashboard_state(runtime), details={'gender': gender})

    return set_gender_filter


def make_brush_scatterplot(runtime: PlainMcpRuntime) -> ToolCallable:
    async def brush_scatterplot(
        min_weight: Annotated[float | None, Field(description='Minimum weight in kilograms.')] = None,
        max_weight: Annotated[float | None, Field(description='Maximum weight in kilograms.')] = None,
        min_height: Annotated[float | None, Field(description='Minimum height in meters.')] = None,
        max_height: Annotated[float | None, Field(description='Maximum height in meters.')] = None,
    ) -> JsonDict:
        """Brush the athlete scatterplot by weight and height."""
        x0 = 0 if min_weight is None else min_weight
        x1 = 250 if max_weight is None else max_weight
        y0 = 1.2 if min_height is None else min_height
        y1 = 2.3 if max_height is None else max_height
        await runtime.execute(
            'vgplot.set_interval_2d',
            {'plotId': 'plot-0', 'interactorId': '0', 'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1},
        )
        return action_response(
            'brush_scatterplot',
            await _dashboard_state(runtime),
            details={'minWeight': x0, 'maxWeight': x1, 'minHeight': y0, 'maxHeight': y1},
        )

    return brush_scatterplot


def make_sort_table(runtime: PlainMcpRuntime) -> ToolCallable:
    async def sort_table(column: AthleteSortColumn, direction: SortDirection = 'asc') -> JsonDict:
        """Sort the athlete table by one displayed column."""
        await runtime.execute(
            'vgplot.table_set_sort',
            {'tableId': 'table-0', 'column': column, 'desc': direction == 'desc'},
        )
        return action_response(
            'sort_table', await _dashboard_state(runtime), details={'column': column, 'direction': direction}
        )

    return sort_table


def make_query_athlete_data(runtime: PlainMcpRuntime) -> ToolCallable:
    async def query_athlete_data(
        sport: str | None = None,
        gender: AthleteGender | None = None,
        name_contains: str | None = None,
        min_weight: float | None = None,
        max_weight: float | None = None,
        min_height: float | None = None,
        max_height: float | None = None,
        sort_by: AthleteSortColumn | None = None,
        sort_direction: SortDirection = 'asc',
        limit: Annotated[int, Field(ge=1, le=500)] = 25,
    ) -> JsonDict:
        """Query the athlete rows behind the dashboard."""
        clauses: list[str] = []
        if sport and sport.strip().lower() != 'all':
            clauses.append(string_equals('sport', sport))
        if gender and gender != 'all':
            clauses.append(string_equals('sex', gender))
        if name_contains:
            clauses.append(lower_like('name', name_contains))
        clauses.extend(numeric_range('weight', min_weight, max_weight))
        clauses.extend(numeric_range('height', min_height, max_height))
        sql = select_query(
            columns=_COLUMNS,
            where=clauses,
            order_by=sort_by or 'name',
            direction=sort_direction,
            limit=limit,
            source='vacp_handle',
        )
        filters = {
            'sport': sport,
            'gender': gender,
            'nameContains': name_contains,
            'minWeight': min_weight,
            'maxWeight': max_weight,
            'minHeight': min_height,
            'maxHeight': max_height,
            'sortBy': sort_by,
            'sortDirection': sort_direction,
            'limit': limit,
        }
        result = await runtime.sql(DATA_REF, sql, max_rows=limit)
        return data_response(result, filters, note='Athlete rows matching the requested dashboard filters.')

    return query_athlete_data


SPEC = UseCaseSpec(
    id='UC3',
    route='/vgplot/#athletes',
    title='Olympic Athletes Dashboard',
    tools=(
        ToolSpec(
            'get_athlete_dashboard_state',
            'Get Athlete Dashboard State',
            'Read the current filters, scatterplot brush, table sort, and data state.',
            make_get_athlete_dashboard_state,
            True,
        ),
        ToolSpec('set_sport_filter', 'Set Sport Filter', 'Set the athlete sport menu.', make_set_sport_filter),
        ToolSpec('set_gender_filter', 'Set Gender Filter', 'Set the athlete sex menu.', make_set_gender_filter),
        ToolSpec(
            'brush_scatterplot',
            'Brush Scatterplot',
            'Brush the scatterplot by weight and height.',
            make_brush_scatterplot,
        ),
        ToolSpec('sort_table', 'Sort Table', 'Sort the athlete table by one displayed column.', make_sort_table),
        ToolSpec(
            'query_athlete_data',
            'Query Athlete Data',
            'Filter and sort the athlete rows behind the dashboard.',
            make_query_athlete_data,
            True,
        ),
    ),
)
