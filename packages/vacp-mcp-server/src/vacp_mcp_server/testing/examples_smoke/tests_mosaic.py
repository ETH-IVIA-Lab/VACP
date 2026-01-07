from __future__ import annotations

from playwright.async_api import Page

from .bridge import expect_bridge, get_capabilities, get_runtime, get_state
from .utils import assert_, stable_json


async def test_mosaic_gallery(page: Page) -> None:
    await expect_bridge(page)

    spec_ids: list[str] = await page.evaluate(
        "() => Array.from(document.querySelectorAll('#spec option')).map(o => o.value)"
    )
    assert_(len(spec_ids) >= 2, 'Expected at least 2 Mosaic specs in the gallery')

    for spec_id in spec_ids:
        await page.evaluate(
            '(id) => {'
            " const sel=document.querySelector('#spec');"
            ' sel.value=id;'
            " sel.dispatchEvent(new Event('change', {bubbles:true}));"
            ' }',
            spec_id,
        )

        await page.wait_for_selector('svg', timeout=60_000)
        await expect_bridge(page)
        await page.wait_for_function(
            '(needle) => globalThis.__vacp.getCapabilities().then(c => {'
            ' const nodes = c.graph?.nodes || [];'
            ' return nodes.some(n => String(n?.ref || "").includes(needle));'
            ' })',
            arg=f'/{spec_id}/plot-0',
            timeout=60_000,
        )

        caps = await get_capabilities(page)
        graph = caps.get('graph', {})
        assert_(isinstance(graph, dict), 'capabilities.graph must be an object')
        assert_(len(graph.get('nodes', [])) > 0, 'Expected graph.nodes to be non-empty')
        assert_(len(graph.get('actions', [])) > 0, 'Expected graph.actions to be non-empty')

        await page.wait_for_selector('svg metadata[type="application/vacp+json"]', timeout=10_000, state='attached')

        actions = graph.get('actions', [])
        has_2d = any(isinstance(a, dict) and a.get('name') == 'mosaic.set_interval_2d' for a in actions)
        has_1d = any(isinstance(a, dict) and a.get('name') == 'mosaic.set_interval_1d' for a in actions)
        has_toggle = any(isinstance(a, dict) and a.get('name') == 'mosaic.set_toggle' for a in actions)
        has_input = any(isinstance(a, dict) and a.get('name') == 'mosaic.set_input_option_index' for a in actions)
        should_change = has_2d or has_1d or has_toggle or has_input

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
        rt_after_set = await get_runtime(page)
        if should_change:
            after_len = len(rt_after_set.get('history', []))
            assert_(
                stable_json(before) != stable_json(after_set),
                'Expected state to change after demo-set',
            )
            assert_(
                after_len >= before_hist + 1,
                f'Expected runtime history to grow after demo-set (spec={spec_id})',
            )

        await page.click('#demo-clear')
        await page.wait_for_function(
            '(n) => globalThis.__vacp.getRuntime().then(rt => (rt.history||[]).length >= n)',
            arg=len(rt_after_set.get('history', [])) + 1,
            timeout=15_000,
        )
        after_clear = await get_state(page)
        rt_after_clear = await get_runtime(page)
        if should_change:
            assert_(
                stable_json(after_set) != stable_json(after_clear),
                'Expected state to change after demo-clear',
            )
            assert_(
                len(rt_after_clear.get('history', [])) >= len(rt_after_set.get('history', [])) + 1,
                'Expected runtime history to grow after demo-clear',
            )

        if has_2d or has_1d:
            svg = page.locator('.plot svg').first
            box = await svg.bounding_box()
            if box:
                rt_h0 = await get_runtime(page)
                before_h = await get_state(page)
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
                    'Expected state to change after human brush drag',
                )
                assert_(
                    len(rt_h1.get('history', [])) >= len(rt_h0.get('history', [])) + 1,
                    'Expected runtime history to grow after human brush drag',
                )
        elif has_input:
            rt_h0 = await get_runtime(page)
            before_h = await get_state(page)
            before_hist = len(rt_h0.get('history', []))
            before_last_at = str(rt_h0.get('history', [])[-1].get('at')) if before_hist and rt_h0.get('history') else ''
            await page.evaluate(
                '() => {'
                " const sel = document.querySelector('.input select');"
                ' if (!sel) return false;'
                ' if (sel.options.length < 2) return false;'
                ' sel.selectedIndex = 1;'
                " sel.dispatchEvent(new Event('input', {bubbles:true}));"
                " sel.dispatchEvent(new Event('change', {bubbles:true}));"
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
            assert_(
                stable_json(before_h) != stable_json(after_h),
                'Expected state to change after human menu change',
            )
            assert_(
                len(rt_h1.get('history', [])) >= before_hist + 1,
                'Expected runtime history to grow after human menu change',
            )
