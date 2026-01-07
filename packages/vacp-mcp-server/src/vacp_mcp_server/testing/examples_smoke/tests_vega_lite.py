from __future__ import annotations

from playwright.async_api import Page

from .bridge import expect_bridge, get_capabilities, get_runtime, get_state
from .utils import assert_, param_values, stable_json


async def test_vega_lite_gallery(page: Page) -> None:
    await expect_bridge(page)

    spec_ids: list[str] = await page.evaluate(
        "() => Array.from(document.querySelectorAll('#spec option')).map(o => o.value)"
    )
    assert_(len(spec_ids) >= 2, 'Expected at least 2 Vega-Lite specs in the gallery')

    for spec_id in spec_ids:
        await page.evaluate(
            '(id) => {'
            " const sel=document.querySelector('#spec');"
            ' sel.value=id;'
            " sel.dispatchEvent(new Event('change', {bubbles:true}));"
            ' }',
            spec_id,
        )
        await page.wait_for_selector('svg', timeout=30_000)
        await expect_bridge(page)
        await page.wait_for_function(
            '(needle) => globalThis.__vacp.getCapabilities().then(c => '
            'String(c.graph?.nodes?.[0]?.ref || "").includes(needle))',
            arg=f'/vega-lite/{spec_id}/{spec_id}',
            timeout=60_000,
        )

        caps = await get_capabilities(page)
        graph = caps.get('graph', {})
        assert_(isinstance(graph, dict), 'capabilities.graph must be an object')
        assert_(len(graph.get('nodes', [])) > 0, 'Expected graph.nodes to be non-empty')
        assert_(len(graph.get('actions', [])) > 0, 'Expected graph.actions to be non-empty')
        assert_(
            any(isinstance(a, dict) and a.get('name') == 'vega_lite.set_param' for a in graph.get('actions', [])),
            'Expected vega_lite.set_param to exist',
        )

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
        rt_after_set = await get_runtime(page)
        assert_(
            len(rt_after_set.get('history', [])) >= before_hist + 1,
            'Expected runtime history to grow after demo-set',
        )

        has_clear = any(
            isinstance(a, dict) and a.get('name') == 'vega_lite.clear_selection' for a in graph.get('actions', [])
        )
        if has_clear:
            await page.click('#demo-clear')
            await page.wait_for_function(
                '(n) => globalThis.__vacp.getRuntime().then(rt => (rt.history||[]).length >= n)',
                arg=len(rt_after_set.get('history', [])) + 1,
                timeout=15_000,
            )
            after_clear = await get_state(page)
            assert_(stable_json(after_set) != stable_json(after_clear), 'Expected state to change after demo-clear')
            rt_after_clear = await get_runtime(page)
            assert_(
                len(rt_after_clear.get('history', [])) >= len(rt_after_set.get('history', [])) + 1,
                'Expected runtime history to grow after demo-clear',
            )

        # Human interaction:
        # - try to brush-drag on the SVG (interval selection specs)
        # - else click within the plot area (point selection specs)
        svg = page.locator('#app svg').first
        box = await svg.bounding_box()
        if box:
            rt_h0 = await get_runtime(page)
            before_h = await get_state(page)

            rects = page.locator('#app svg rect')
            if await rects.count() > 5:
                await page.mouse.click(box['x'] + box['width'] * 0.2, box['y'] + box['height'] * 0.85)
            else:
                await page.mouse.move(box['x'] + box['width'] * 0.25, box['y'] + box['height'] * 0.25)
                await page.mouse.down()
                await page.mouse.move(box['x'] + box['width'] * 0.65, box['y'] + box['height'] * 0.65, steps=12)
                await page.mouse.up()

            await page.wait_for_function(
                '(n) => globalThis.__vacp.getRuntime().then(rt => (rt.history||[]).length >= n)',
                arg=len(rt_h0.get('history', [])) + 1,
                timeout=15_000,
            )
            after_h = await get_state(page)
            rt_h1 = await get_runtime(page)
            assert_(
                stable_json(before_h) != stable_json(after_h),
                'Expected state to change after human interaction (brush or click)',
            )
            assert_(
                len(rt_h1.get('history', [])) >= len(rt_h0.get('history', [])) + 1,
                'Expected runtime history to grow after human interaction (brush or click)',
            )

        slider = page.locator('#app input[type="range"]').first
        if await slider.count() > 0:
            rt_h0 = await get_runtime(page)
            before_h = await get_state(page)
            before_hist = len(rt_h0.get('history', []))
            before_last_at = str(rt_h0.get('history', [])[-1].get('at')) if before_hist and rt_h0.get('history') else ''
            await page.evaluate(
                '() => {'
                ' const el=document.querySelector(\'#app input[type="range"]\');'
                ' if (!el) return false;'
                " const min = Number(el.min || '0');"
                " const max = Number(el.max || '100');"
                ' const next = String(min + 0.8 * (max - min));'
                ' el.value = next;'
                " el.dispatchEvent(new Event('input', {bubbles:true}));"
                " el.dispatchEvent(new Event('change', {bubbles:true}));"
                ' return true;'
                ' }'
            )
            await page.wait_for_function(
                '(x) => globalThis.__vacp.getRuntime().then(rt => {'
                ' const h = rt.history || [];'
                ' if (h.length > x.beforeLen) return true;'
                ' const last = h.length ? String(h[h.length - 1].at || "") : "";'
                ' return x.beforeAt && last && last !== x.beforeAt;'
                ' })',
                arg={'beforeLen': before_hist, 'beforeAt': before_last_at},
                timeout=15_000,
            )
            after_h = await get_state(page)
            rt_h1 = await get_runtime(page)
            before_vals = param_values(before_h)
            after_vals = param_values(after_h)
            assert_(
                any(ref in after_vals and after_vals[ref] != before_vals.get(ref) for ref in before_vals),
                'Expected at least one Param value to change after human slider change',
            )
            assert_(
                rt_h0.get('runtimeId') == rt_h1.get('runtimeId'),
                'Expected stable runtime across slider change',
            )

        await page.wait_for_selector('svg metadata[type="application/vacp+json"]', timeout=10_000, state='attached')
