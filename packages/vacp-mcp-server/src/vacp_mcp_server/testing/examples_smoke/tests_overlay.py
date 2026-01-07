from __future__ import annotations

from playwright.async_api import Page

from .bridge import expect_bridge


async def test_debug_overlay(page: Page) -> None:
    # Ensure the bridge is ready first so the overlay renders a diagram.
    await expect_bridge(page)

    await page.wait_for_selector('button.vacp-debug-ui-button', timeout=30_000)
    await page.click('button.vacp-debug-ui-button')
    await page.wait_for_selector('.vacp-debug-ui-panel', timeout=30_000)
    await page.wait_for_function(
        '() => {'
        " const p=document.querySelector('.vacp-debug-ui-panel');"
        " return p && getComputedStyle(p).display !== 'none';"
        ' }'
    )
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

    await page.click('button:has-text("Close")')
    await page.wait_for_function(
        '() => {'
        " const p=document.querySelector('.vacp-debug-ui-panel');"
        " return !p || getComputedStyle(p).display === 'none';"
        ' }'
    )
