from __future__ import annotations

from playwright.async_api import Page

from .bridge import (
    data_sql,
    expect_bridge,
    get_capabilities,
    get_runtime,
    get_state,
    wait_for_capability_ref_contains,
    wait_for_history_len_at_least,
    wait_for_runtime_changed,
)
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
        await wait_for_capability_ref_contains(page, f'/vega-lite/{spec_id}/{spec_id}', timeout_ms=60_000)

        caps = await get_capabilities(page)
        graph = caps.get('graph', {})
        assert_(isinstance(graph, dict), 'capabilities.graph must be an object')
        assert_(len(graph.get('nodes', [])) > 0, 'Expected graph.nodes to be non-empty')
        assert_(len(graph.get('actions', [])) > 0, 'Expected graph.actions to be non-empty')
        assert_(
            any(isinstance(a, dict) and a.get('name') == 'vega_lite.set_param' for a in graph.get('actions', [])),
            'Expected vega_lite.set_param to exist',
        )
        assert_(
            any(isinstance(a, dict) and a.get('name') == 'vacp.data_sql' for a in graph.get('actions', [])),
            'Expected vacp.data_sql action to exist',
        )

        handles = [
            n
            for n in graph.get('nodes', [])
            if isinstance(n, dict)
            and n.get('kind') == 'DataHandle'
            and f'/vega-lite/{spec_id}/' in str(n.get('ref', ''))
        ]
        assert_(len(handles) >= 1, f'Expected at least one DataHandle node (spec={spec_id})')
        handle_ref = handles[0].get('ref')
        assert_(
            isinstance(handle_ref, str) and handle_ref.startswith('vacp://'),
            f'DataHandle.ref must be a vacp:// string (spec={spec_id})',
        )

        res_all = await data_sql(page, handle_ref=handle_ref, sql='SELECT COUNT(*)::INTEGER AS n FROM vacp_all')
        assert_(res_all.get('ok') is True, f'Expected vacp.data_sql ok=true (spec={spec_id})')
        n_all = ((res_all.get('result') or {}).get('rows') or [{}])[0].get('n')
        assert_(
            isinstance(n_all, int) and n_all > 0,
            f'Expected COUNT(*) to return a positive integer (spec={spec_id})',
        )

        before = await get_state(page)
        rt_before = await get_runtime(page)
        before_hist = len(rt_before.get('history', []))
        await page.click('#demo-set')
        await wait_for_history_len_at_least(page, before_hist + 1, timeout_ms=15_000)
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
            await wait_for_history_len_at_least(page, len(rt_after_set.get('history', [])) + 1, timeout_ms=15_000)
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

            selection_nodes = [
                n
                for n in graph.get('nodes', [])
                if isinstance(n, dict) and n.get('kind') == 'Selection' and isinstance(n.get('data'), dict)
            ]
            is_interval = any(
                isinstance((n.get('data') or {}).get('select'), dict)
                and ((n.get('data') or {}).get('select') or {}).get('type') == 'interval'
                for n in selection_nodes
            )
            if is_interval:
                await page.mouse.move(box['x'] + box['width'] * 0.25, box['y'] + box['height'] * 0.25)
                await page.mouse.down()
                await page.mouse.move(box['x'] + box['width'] * 0.65, box['y'] + box['height'] * 0.65, steps=12)
                await page.mouse.up()
            else:
                # Point selections are easiest to trigger by clicking an actual
                # mark element instead of guessing coordinates.
                mark = page.locator('#app svg g.mark-symbol path').first
                if await mark.count() == 0:
                    mark = page.locator('#app svg g.mark-rect path').first
                if await mark.count() == 0:
                    mark = page.locator('#app svg path').first
                mb = await mark.bounding_box()
                if mb:
                    await page.mouse.click(mb['x'] + mb['width'] * 0.5, mb['y'] + mb['height'] * 0.5)
                else:
                    await page.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5)

            await wait_for_history_len_at_least(page, len(rt_h0.get('history', [])) + 1, timeout_ms=15_000)
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

            # Re-resolve the handle ref after interaction to avoid races during spec swaps.
            caps_after = await get_capabilities(page)
            graph_after = caps_after.get('graph', {})
            handles_after = [
                n
                for n in graph_after.get('nodes', [])
                if isinstance(n, dict)
                and n.get('kind') == 'DataHandle'
                and f'/vega-lite/{spec_id}/' in str(n.get('ref', ''))
            ]
            assert_(len(handles_after) >= 1, f'Expected DataHandle to remain available (spec={spec_id})')
            handle_ref_after = handles_after[0].get('ref')
            assert_(
                isinstance(handle_ref_after, str) and handle_ref_after.startswith('vacp://'),
                f'DataHandle.ref must be a vacp:// string (spec={spec_id})',
            )
            res_sel = await data_sql(
                page,
                handle_ref=handle_ref_after,
                sql='SELECT COUNT(*)::INTEGER AS n FROM vacp_handle',
            )
            assert_(res_sel.get('ok') is True, f'Expected vacp.data_sql (selected) ok=true (spec={spec_id})')
            n_sel = ((res_sel.get('result') or {}).get('rows') or [{}])[0].get('n')
            assert_(isinstance(n_sel, int), f'Expected selected COUNT(*) to return an integer (spec={spec_id})')
            assert_(n_sel <= n_all, f'Expected selected count <= all count (spec={spec_id})')
            assert_(n_sel != n_all, f'Expected selection to change row count (spec={spec_id})')

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
            await wait_for_runtime_changed(
                page,
                before_len=before_hist,
                before_last_at=before_last_at,
                timeout_ms=15_000,
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
