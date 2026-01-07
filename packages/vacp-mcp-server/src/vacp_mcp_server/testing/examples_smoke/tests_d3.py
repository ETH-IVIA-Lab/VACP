from __future__ import annotations

from playwright.async_api import Page

from .bridge import (
    data_sql,
    expect_bridge,
    get_capabilities,
    get_runtime,
    get_state,
    wait_for_history_len_at_least,
)
from .utils import assert_, stable_json


async def test_d3_scatter_lasso(page: Page) -> None:
    await expect_bridge(page)

    caps = await get_capabilities(page)
    graph = caps.get('graph', {})
    assert_(isinstance(graph, dict), 'capabilities.graph must be an object')
    assert_(
        any(isinstance(a, dict) and a.get('name') == 'vanilla.set_lasso_polygon' for a in graph.get('actions', [])),
        'Expected vanilla.set_lasso_polygon action to exist',
    )
    assert_(
        any(isinstance(a, dict) and a.get('name') == 'vanilla.clear_lasso' for a in graph.get('actions', [])),
        'Expected vanilla.clear_lasso action to exist',
    )
    assert_(
        any(isinstance(a, dict) and a.get('name') == 'vacp.data_sql' for a in graph.get('actions', [])),
        'Expected vacp.data_sql action to exist',
    )

    handles = [n for n in graph.get('nodes', []) if isinstance(n, dict) and n.get('kind') == 'DataHandle']
    assert_(len(handles) >= 1, 'Expected at least one DataHandle node')
    handle_ref = handles[0].get('ref')
    assert_(isinstance(handle_ref, str) and handle_ref.startswith('vacp://'), 'DataHandle.ref must be a vacp:// string')

    res_all = await data_sql(page, handle_ref=handle_ref, sql='SELECT COUNT(*)::INTEGER AS n FROM vacp_all')
    assert_(res_all.get('ok') is True, 'Expected vacp.data_sql to return ok=true')
    n_all = ((res_all.get('result') or {}).get('rows') or [{}])[0].get('n')
    assert_(isinstance(n_all, int) and n_all > 0, 'Expected COUNT(*) to return a positive integer')

    await page.wait_for_selector('svg metadata[type="application/vacp+json"]', timeout=10_000, state='attached')

    before = await get_state(page)
    rt_before = await get_runtime(page)
    before_hist = len(rt_before.get('history', []))
    await page.click('#demo-set')
    await wait_for_history_len_at_least(page, before_hist + 1, timeout_ms=15_000)
    after_set = await get_state(page)
    assert_(stable_json(before) != stable_json(after_set), 'Expected state to change after demo-set')

    res_sel = await data_sql(page, handle_ref=handle_ref, sql='SELECT COUNT(*)::INTEGER AS n FROM vacp_handle')
    assert_(res_sel.get('ok') is True, 'Expected vacp.data_sql (selected) to return ok=true')
    n_sel = ((res_sel.get('result') or {}).get('rows') or [{}])[0].get('n')
    assert_(isinstance(n_sel, int), 'Expected selected COUNT(*) to return an integer')
    assert_(n_sel <= n_all, 'Expected selected count to be <= all count')
    assert_(n_sel != n_all, 'Expected selection to change row count')

    await page.click('#demo-clear')
    await page.wait_for_timeout(250)
    after_clear = await get_state(page)
    assert_(stable_json(after_set) != stable_json(after_clear), 'Expected state to change after demo-clear')

    svg = page.locator('#plot svg').first
    box = await svg.bounding_box()
    if box:
        rt_h0 = await get_runtime(page)
        before_h = await get_state(page)
    await page.mouse.move(box['x'] + box['width'] * 0.25, box['y'] + box['height'] * 0.35)
    await page.mouse.down()
    await page.mouse.move(box['x'] + box['width'] * 0.55, box['y'] + box['height'] * 0.30, steps=8)
    await page.mouse.move(box['x'] + box['width'] * 0.60, box['y'] + box['height'] * 0.55, steps=8)
    await page.mouse.move(box['x'] + box['width'] * 0.30, box['y'] + box['height'] * 0.60, steps=8)
    await page.mouse.up()
    await wait_for_history_len_at_least(page, len(rt_h0.get('history', [])) + 1, timeout_ms=15_000)
    after_h = await get_state(page)
    assert_(stable_json(before_h) != stable_json(after_h), 'Expected state to change after human lasso')
