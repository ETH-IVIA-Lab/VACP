from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from plain_mcp.protocol import ToolCallable, ToolSpec, UseCaseSpec
from plain_mcp.runtime import JsonDict, PlainMcpRuntime
from plain_mcp.sql import action_response, data_response, numeric_range, select_query

BRUSH_REF = 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords/selection/brushes'
ORDER_REF = 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords/param/dimension_order'
HOVER_REF = 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords/selection/hover'
DATA_REF = 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords/data/cars'

CarsDimension = Literal['MPG', 'Cylinders', 'Displacement', 'Horsepower', 'Weight', 'Acceleration', 'Model']
_DIMENSIONS: tuple[CarsDimension, ...] = (
    'MPG',
    'Cylinders',
    'Displacement',
    'Horsepower',
    'Weight',
    'Acceleration',
    'Model',
)
_COLUMNS = ('Car', 'Origin', 'MPG', 'Cylinders', 'Displacement', 'Horsepower', 'Weight', 'Acceleration', 'Model', 'id')


async def _pcp_state(runtime: PlainMcpRuntime) -> JsonDict:
    snapshot = await runtime.state()
    brushes = runtime.state_entry(snapshot, BRUSH_REF)
    order = runtime.state_entry(snapshot, ORDER_REF)
    hover = runtime.state_entry(snapshot, HOVER_REF)
    return {
        'axisOrder': order.get('value'),
        'brushes': brushes.get('ranges', {}),
        'selectedCount': brushes.get('selectedCount'),
        'totalCount': brushes.get('totalCount'),
        'hover': {
            'id': hover.get('hoveredId'),
            'car': hover.get('hoveredCar'),
        },
    }


def make_get_pcp_state(runtime: PlainMcpRuntime) -> ToolCallable:
    async def get_pcp_state() -> JsonDict:
        """Return the current parallel coordinates axis order and brushes."""
        return await _pcp_state(runtime)

    return get_pcp_state


def make_set_axis_order(runtime: PlainMcpRuntime) -> ToolCallable:
    async def set_axis_order(
        order: Annotated[list[CarsDimension], Field(min_length=7, max_length=7)],
    ) -> JsonDict:
        """Set the parallel coordinates axis order."""
        if set(order) != set(_DIMENSIONS):
            raise ValueError('Axis order must contain each cars dimension exactly once')
        await runtime.execute('parallel_coords.set_dimension_order', {'order': list(order)})
        return action_response('set_axis_order', await _pcp_state(runtime), details={'axisOrder': list(order)})

    return set_axis_order


def make_brush_axis_range(runtime: PlainMcpRuntime) -> ToolCallable:
    async def brush_axis_range(
        dimension: CarsDimension,
        min_value: float,
        max_value: float,
    ) -> JsonDict:
        """Brush one parallel coordinates axis by data range."""
        await runtime.execute(
            'parallel_coords.set_brush_ranges',
            {'ranges': {dimension: [min_value, max_value]}},
        )
        return action_response(
            'brush_axis_range',
            await _pcp_state(runtime),
            details={'dimension': dimension, 'minValue': min_value, 'maxValue': max_value},
        )

    return brush_axis_range


def make_clear_brushes(runtime: PlainMcpRuntime) -> ToolCallable:
    async def clear_brushes() -> JsonDict:
        """Clear all active parallel coordinates brushes."""
        await runtime.execute('parallel_coords.reset_brushes', {})
        return action_response('clear_brushes', await _pcp_state(runtime))

    return clear_brushes


def make_query_cars_data(runtime: PlainMcpRuntime) -> ToolCallable:
    async def query_cars_data(
        dimension: CarsDimension | None = None,
        min_value: float | None = None,
        max_value: float | None = None,
        limit: Annotated[int, Field(ge=1, le=500)] = 25,
    ) -> JsonDict:
        """Query the cars rows behind the parallel coordinates chart."""
        if dimension is None and (min_value is not None or max_value is not None):
            raise ValueError('Provide dimension when filtering cars by min_value or max_value')
        clauses: list[str] = []
        if dimension:
            clauses.extend(numeric_range(dimension, min_value, max_value))
        sql = select_query(
            columns=_COLUMNS,
            where=clauses,
            order_by=dimension or 'Car',
            direction='asc',
            limit=limit,
            source='vacp_handle',
        )
        filters = {
            'dimension': dimension,
            'minValue': min_value,
            'maxValue': max_value,
            'limit': limit,
        }
        result = await runtime.sql(DATA_REF, sql, max_rows=limit)
        return data_response(result, filters, note='Car rows matching the requested axis filter.')

    return query_cars_data


SPEC = UseCaseSpec(
    id='UC5',
    route='/cars-parcoords/',
    title='Cars Parallel Coordinates',
    tools=(
        ToolSpec(
            'get_pcp_state',
            'Get PCP State',
            'Read the current axis order, brushes, hover, and data summary.',
            make_get_pcp_state,
            True,
        ),
        ToolSpec('set_axis_order', 'Set Axis Order', 'Set the parallel coordinates axis order.', make_set_axis_order),
        ToolSpec('brush_axis_range', 'Brush Axis Range', 'Brush one axis by numeric range.', make_brush_axis_range),
        ToolSpec('clear_brushes', 'Clear Brushes', 'Clear all active axis brushes.', make_clear_brushes),
        ToolSpec(
            'query_cars_data',
            'Query Cars Data',
            'Filter and sort the cars rows behind the chart.',
            make_query_cars_data,
            True,
        ),
    ),
)
