from __future__ import annotations

import pytest
from plain_mcp.registry import USE_CASES, get_use_case


def test_use_case_routes_match_plain_mcp_contract() -> None:
    assert USE_CASES['UC1'].route == '/vega-lite/#global-development'
    assert USE_CASES['UC2'].route == '/vega-lite/#seattle-weather'
    assert USE_CASES['UC3'].route == '/vgplot/#athletes'
    assert USE_CASES['UC4'].route == '/vega-lite/#airports'
    assert USE_CASES['UC5'].route == '/cars-parcoords/'


def test_use_case_tool_names_match_contract() -> None:
    assert [tool.name for tool in USE_CASES['UC1'].tools] == [
        'get_bubble_chart_state',
        'set_year',
        'zoom_chart',
        'hover_country',
        'query_gapminder_data',
    ]
    assert [tool.name for tool in USE_CASES['UC2'].tools] == [
        'get_weather_chart_state',
        'brush_date_range',
        'select_weather_category',
        'hover_weather_point',
        'query_weather_data',
    ]
    assert [tool.name for tool in USE_CASES['UC3'].tools] == [
        'get_athlete_dashboard_state',
        'set_sport_filter',
        'set_gender_filter',
        'brush_scatterplot',
        'sort_table',
        'query_athlete_data',
    ]
    assert [tool.name for tool in USE_CASES['UC4'].tools] == [
        'get_flight_map_state',
        'select_airport',
        'filter_routes',
        'hover_route',
        'query_flight_data',
    ]
    assert [tool.name for tool in USE_CASES['UC5'].tools] == [
        'get_pcp_state',
        'set_axis_order',
        'brush_axis_range',
        'clear_brushes',
        'query_cars_data',
    ]


def test_get_use_case_normalizes_id() -> None:
    assert get_use_case('uc4').id == 'UC4'


def test_get_use_case_rejects_unknown_id() -> None:
    with pytest.raises(ValueError):
        get_use_case('UC9')
