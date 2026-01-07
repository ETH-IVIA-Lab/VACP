from __future__ import annotations

from playwright.async_api import Page

from .bridge import expect_bridge, get_capabilities, get_runtime, get_state
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

    await page.wait_for_selector('svg metadata[type="application/vacp+json"]', timeout=10_000, state='attached')

    before = await get_state(page)
    rt_before = await get_runtime(page)
    before_hist = len(rt_before.get('history', []))
    await page.click('#demo-set')
    await page.wait_for_function(
        '(n) => globalThis.__vacp.getRuntime().then(rt => (rt.history||[]).length >= n)',
        arg=before_hist + 1,
        timeout=15_000,
    )
    after_set = await get_state(page)
    assert_(stable_json(before) != stable_json(after_set), 'Expected state to change after demo-set')

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
        await page.wait_for_function(
            '(n) => globalThis.__vacp.getRuntime().then(rt => (rt.history||[]).length >= n)',
            arg=len(rt_h0.get('history', [])) + 1,
            timeout=15_000,
        )
        after_h = await get_state(page)
        assert_(stable_json(before_h) != stable_json(after_h), 'Expected state to change after human lasso')
