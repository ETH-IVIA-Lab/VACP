import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

function parseTitle(text: string): { mode: string; cursor: number; history: number } {
  const m = text.match(/mode=(\w+)\s+cursor=(-?\d+)\s+history=(\d+)/);
  if (!m) throw new Error(`Could not parse debug-ui title: ${text}`);
  return { mode: m[1]!, cursor: Number(m[2]!), history: Number(m[3]!) };
}

test('debug-ui: time travel does not extend history (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const overlay = page.locator('#app svg').first().locator('rect.overlay').first();
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const brush = async (fromFrac: number, toFrac: number) => {
      const y = box.y + box.height * 0.5;
      const x0 = box.x + box.width * fromFrac;
      const x1 = box.x + box.width * toFrac;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      await page.mouse.move(x1, y);
      await page.mouse.up();
    };

    await brush(0.15, 0.45);
    await page.waitForFunction(() => {
      const r = document.querySelector('#app')?.querySelector('svg')?.querySelector('rect.selection') as SVGRectElement | null;
      if (!r) return false;
      const b = r.getBBox();
      return b.width > 2 && b.height > 2;
    });
    await brush(0.6, 0.9);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const historyTab = page.locator('.vacp-debug-ui-module', { hasText: 'History' });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-vacp-row="history-entry"][data-has-state="true"]');
      return rows.length >= 2;
    });

    await page.locator('button[aria-label="Undo"]').click();
    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
      return /mode=inspect/.test(t);
    });

    const title = page.locator('.vacp-debug-ui-title');
    const entry = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]').first();
    await expect(entry).toBeVisible();
    const idxText = await entry.getAttribute('data-index');
    const idx = Number(idxText);
    expect(Number.isFinite(idx)).toBeTruthy();

    const before = parseTitle(await title.innerText());
    await entry.click();
    await page.waitForFunction(
      ({ expectedCursor }) => {
        const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
        const m = t.match(/mode=(\w+)\s+cursor=(-?\d+)/);
        if (!m) return false;
        return m[1] === 'inspect' && Number(m[2]) === expectedCursor;
      },
      { expectedCursor: idx },
    );

    await page.waitForTimeout(700);

    const after = parseTitle(await title.innerText());
    expect(after.mode).toBe('inspect');
    expect(after.history).toBe(before.history);
  } finally {
    await srv.stop();
  }
});

