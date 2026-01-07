from __future__ import annotations

import asyncio
import json
import os
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from playwright.async_api import Page, async_playwright

"""
Smoke tests for the example apps (project concepts).

These examples are the living "demo + regression test" for VACP:
- verify the window bridge exists and returns capabilities/state
- verify DOM/SVG annotations exist (fallback surface)
- verify semantic actions execute and state changes
- verify the debug overlay renders Mermaid to SVG when enabled

The tests intentionally run the example Vite dev servers to match how humans
interact during development.
"""

ROOT = Path(__file__).resolve().parents[4]  # vacp/
EXAMPLES_DIR = ROOT / 'packages' / 'examples'
ARTIFACTS_DIR = ROOT / '.artifacts' / 'examples-smoke'


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        s.listen(1)
        return int(s.getsockname()[1])


async def _wait_http_ready(url: str, timeout_s: float = 30.0) -> None:
    import urllib.request

    start = asyncio.get_event_loop().time()
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2) as _:
                return
        except Exception as err:
            if asyncio.get_event_loop().time() - start > timeout_s:
                raise TimeoutError(f'Timed out waiting for server: {url}') from err
            await asyncio.sleep(0.2)


@dataclass(frozen=True)
class DevServer:
    name: str
    cwd: Path
    port: int
    url: str
    proc: asyncio.subprocess.Process
    log_path: Path

    async def stop(self) -> None:
        if self.proc.returncode is not None:
            return
        self.proc.terminate()
        try:
            await asyncio.wait_for(self.proc.wait(), timeout=10)
        except TimeoutError:
            self.proc.kill()
            await self.proc.wait()


async def _start_vite_dev_server(name: str, cwd: Path, port: int) -> DevServer:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = ARTIFACTS_DIR / f'{name}.dev.log'
    log_f = log_path.open('wb')
    proc = await asyncio.create_subprocess_exec(
        'pnpm',
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        str(port),
        '--strictPort',
        cwd=str(cwd),
        stdout=log_f,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, 'BROWSER': 'none'},
    )
    url = f'http://127.0.0.1:{port}/'
    try:
        await _wait_http_ready(url, timeout_s=45)
    except Exception:
        await DevServer(
            name=name,
            cwd=cwd,
            port=port,
            url=url,
            proc=proc,
            log_path=log_path,
        ).stop()
        raise
    return DevServer(name=name, cwd=cwd, port=port, url=url, proc=proc, log_path=log_path)


async def _expect_bridge(page: Page) -> None:
    await page.wait_for_function(
        "() => !!globalThis.__vacp && typeof globalThis.__vacp.getCapabilities === 'function' && typeof globalThis.__vacp.getRuntime === 'function'"
    )


async def _get_capabilities(page: Page) -> dict[str, Any]:
    return await page.evaluate('async () => await globalThis.__vacp.getCapabilities()')


async def _get_state(page: Page) -> dict[str, Any]:
    return await page.evaluate('async () => await globalThis.__vacp.getState()')

async def _get_runtime(page: Page) -> dict[str, Any]:
    return await page.evaluate('async () => await globalThis.__vacp.getRuntime()')


async def _execute(page: Page, name: str, params: dict[str, Any]) -> dict[str, Any]:
    return await page.evaluate(
        'async ({name, params}) => await globalThis.__vacp.execute({callId: crypto.randomUUID(), name, params})',
        {'name': name, 'params': params},
    )


def _assert(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


async def _test_debug_overlay(page: Page) -> None:
    # The overlay can open before the bridge is installed; ensure the bridge is
    # ready first so the overlay renders a diagram immediately.
    await _expect_bridge(page)

    # debug-ui inserts a fixed "VACP" button when enabled.
    await page.wait_for_selector('button.vacp-debug-ui-button', timeout=30_000)
    await page.click('button.vacp-debug-ui-button')
    await page.wait_for_selector('.vacp-debug-ui-panel', timeout=30_000)
    await page.wait_for_function(
        '() => {'
        " const p=document.querySelector('.vacp-debug-ui-panel');"
        " return p && getComputedStyle(p).display !== 'none';"
        ' }'
    )
    # Expect Mermaid-rendered SVG inside the panel (or fail with a useful error).
    await page.wait_for_function(
        '() => {'
        " const host=document.querySelector('.vacp-debug-ui-svg');"
        ' if (!host) return false;'
        " if (host.querySelector('svg')) return true;"
        " const txt=(host.textContent||'').trim();"
        " if (txt.startsWith('Mermaid render failed:')) throw new Error(txt);"
        ' return false;'
        ' }',
        timeout=60_000,
    )

    # Close the panel so it doesn't intercept pointer events during other tests.
    await page.click('button:has-text("Close")')
    await page.wait_for_function(
        '() => {'
        " const p=document.querySelector('.vacp-debug-ui-panel');"
        " return !p || getComputedStyle(p).display === 'none';"
        ' }'
    )


async def _test_mosaic_gallery(page: Page) -> None:
    await _expect_bridge(page)

    # Iterate through each spec option and ensure bridge + SVG annotations exist.
    spec_ids: list[str] = await page.evaluate(
        "() => Array.from(document.querySelectorAll('#spec option')).map(o => o.value)"
    )
    _assert(len(spec_ids) >= 2, 'Expected at least 2 Mosaic specs in the gallery')

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
        await _expect_bridge(page)

        caps = await _get_capabilities(page)
        graph = caps.get('graph', {})
        _assert(isinstance(graph, dict), 'capabilities.graph must be an object')
        _assert(len(graph.get('nodes', [])) > 0, 'Expected graph.nodes to be non-empty')
        _assert(len(graph.get('actions', [])) > 0, 'Expected graph.actions to be non-empty')

        # DOM/SVG fallback evidence: metadata graph must be embedded.
        await page.wait_for_selector('svg metadata[type="application/vacp+json"]', timeout=10_000, state='attached')

        # Demo: if interval actions are available, set and clear.
        actions = graph.get('actions', [])
        has_2d = any(isinstance(a, dict) and a.get('name') == 'mosaic.set_interval_2d' for a in actions)
        has_1d = any(isinstance(a, dict) and a.get('name') == 'mosaic.set_interval_1d' for a in actions)

        before = await _get_state(page)
        rt_before = await _get_runtime(page)
        await page.click('#demo-set')
        await page.wait_for_timeout(300)
        after_set = await _get_state(page)
        rt_after_set = await _get_runtime(page)
        if has_2d or has_1d:
            _assert(
                json.dumps(before, sort_keys=True) != json.dumps(after_set, sort_keys=True),
                'Expected state to change after demo-set',
            )
            _assert(
                int(rt_after_set.get('historyLen', len(rt_after_set.get('history', []))))
                >= int(rt_before.get('historyLen', len(rt_before.get('history', [])))) + 1,
                'Expected runtime history to grow after demo-set',
            )

        await page.click('#demo-clear')
        await page.wait_for_timeout(300)
        after_clear = await _get_state(page)
        rt_after_clear = await _get_runtime(page)
        if has_2d or has_1d:
            _assert(
                json.dumps(after_set, sort_keys=True) != json.dumps(after_clear, sort_keys=True),
                'Expected state to change after demo-clear',
            )
            _assert(
                int(rt_after_clear.get('historyLen', len(rt_after_clear.get('history', []))))
                >= int(rt_after_set.get('historyLen', len(rt_after_set.get('history', [])))) + 1,
                'Expected runtime history to grow after demo-clear',
            )

        # Human interaction: simulate a brush drag on the plot when possible.
        if has_2d or has_1d:
            svg = page.locator('.plot svg').first
            box = await svg.bounding_box()
            if box:
                rt_h0 = await _get_runtime(page)
                before_h = await _get_state(page)
                await page.mouse.move(box['x'] + box['width'] * 0.25, box['y'] + box['height'] * 0.25)
                await page.mouse.down()
                await page.mouse.move(box['x'] + box['width'] * 0.65, box['y'] + box['height'] * 0.65, steps=12)
                await page.mouse.up()
                await page.wait_for_timeout(500)
                after_h = await _get_state(page)
                rt_h1 = await _get_runtime(page)
                _assert(
                    json.dumps(before_h, sort_keys=True) != json.dumps(after_h, sort_keys=True),
                    'Expected state to change after human brush drag',
                )
                _assert(
                    int(rt_h1.get('historyLen', len(rt_h1.get('history', []))))
                    >= int(rt_h0.get('historyLen', len(rt_h0.get('history', [])))) + 1,
                    'Expected runtime history to grow after human brush drag',
                )


async def _test_vega_lite_gallery(page: Page) -> None:
    await _expect_bridge(page)

    spec_ids: list[str] = await page.evaluate(
        "() => Array.from(document.querySelectorAll('#spec option')).map(o => o.value)"
    )
    _assert(len(spec_ids) >= 2, 'Expected at least 2 Vega-Lite specs in the gallery')

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
        await _expect_bridge(page)

        caps = await _get_capabilities(page)
        graph = caps.get('graph', {})
        _assert(isinstance(graph, dict), 'capabilities.graph must be an object')
        _assert(len(graph.get('nodes', [])) > 0, 'Expected graph.nodes to be non-empty')
        _assert(len(graph.get('actions', [])) > 0, 'Expected graph.actions to be non-empty')

        # Debug actions should always include set_param; clear_param only if selections exist.
        _assert(
            any(isinstance(a, dict) and a.get('name') == 'vega_lite.set_param' for a in graph.get('actions', [])),
            'Expected vega_lite.set_param to exist',
        )

        before = await _get_state(page)
        rt_before = await _get_runtime(page)
        await page.click('#demo-set')
        await page.wait_for_timeout(200)
        after_set = await _get_state(page)
        _assert(
            json.dumps(before, sort_keys=True) != json.dumps(after_set, sort_keys=True),
            'Expected state to change after demo-set',
        )
        rt_after_set = await _get_runtime(page)
        _assert(
            int(rt_after_set.get('historyLen', len(rt_after_set.get('history', []))))
            >= int(rt_before.get('historyLen', len(rt_before.get('history', [])))) + 1,
            'Expected runtime history to grow after demo-set',
        )

        has_clear = any(
            isinstance(a, dict) and a.get('name') == 'vega_lite.clear_param' for a in graph.get('actions', [])
        )
        if has_clear:
            await page.click('#demo-clear')
            await page.wait_for_timeout(200)
            after_clear = await _get_state(page)
            _assert(
                json.dumps(after_set, sort_keys=True) != json.dumps(after_clear, sort_keys=True),
                'Expected state to change after demo-clear',
            )
            rt_after_clear = await _get_runtime(page)
            _assert(
                int(rt_after_clear.get('historyLen', len(rt_after_clear.get('history', []))))
                >= int(rt_after_set.get('historyLen', len(rt_after_set.get('history', [])))) + 1,
                'Expected runtime history to grow after demo-clear',
            )

        # Human interaction: try to change a slider param (if present).
        slider = page.locator('#app input[type="range"]').first
        if await slider.count() > 0:
            rt_h0 = await _get_runtime(page)
            before_h = await _get_state(page)
            await page.evaluate(
                "() => {"
                " const el=document.querySelector('#app input[type=\"range\"]');"
                " if (!el) return false;"
                " el.value='80';"
                " el.dispatchEvent(new Event('input', {bubbles:true}));"
                " el.dispatchEvent(new Event('change', {bubbles:true}));"
                " return true;"
                " }"
            )
            await page.wait_for_timeout(250)
            after_h = await _get_state(page)
            rt_h1 = await _get_runtime(page)
            _assert(
                json.dumps(before_h, sort_keys=True) != json.dumps(after_h, sort_keys=True),
                'Expected state to change after human slider change',
            )
            _assert(
                int(rt_h1.get('historyLen', len(rt_h1.get('history', []))))
                >= int(rt_h0.get('historyLen', len(rt_h0.get('history', [])))) + 1,
                'Expected runtime history to grow after human slider change',
            )

        # DOM/SVG fallback evidence: metadata graph must be embedded when rendering to SVG.
        await page.wait_for_selector('svg metadata[type="application/vacp+json"]', timeout=10_000, state='attached')


async def main() -> int:
    mosaic_port = _free_port()
    vega_port = _free_port()

    mosaic_srv = await _start_vite_dev_server(
        'mosaic-linear-regression',
        EXAMPLES_DIR / 'mosaic-linear-regression',
        mosaic_port,
    )
    vega_srv = await _start_vite_dev_server(
        'vega-lite-params',
        EXAMPLES_DIR / 'vega-lite-params',
        vega_port,
    )

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            ctx = await browser.new_context()

            page = await ctx.new_page()
            await page.goto(mosaic_srv.url + '?vacpDebug=1', wait_until='domcontentloaded')
            await _test_debug_overlay(page)
            await _test_mosaic_gallery(page)
            await page.close()

            page = await ctx.new_page()
            await page.goto(vega_srv.url + '?vacpDebug=1', wait_until='domcontentloaded')
            await _test_debug_overlay(page)
            await _test_vega_lite_gallery(page)
            await page.close()

            await ctx.close()
            await browser.close()

    finally:
        await mosaic_srv.stop()
        await vega_srv.stop()

    print('OK: examples smoke tests passed')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130) from None
