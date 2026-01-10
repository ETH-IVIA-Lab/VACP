import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

function parseMeta(text: string): { mode: string; cursor: number; history: number } {
  const mode = text.match(/mode=(\w+)/)?.[1];
  const cursor = text.match(/cursor=(-?\d+)/)?.[1];
  const history = text.match(/history=(\d+)/)?.[1];
  if (!mode || !cursor || !history) throw new Error(`Could not parse debug-ui meta: ${text}`);
  return { mode, cursor: Number(cursor), history: Number(history) };
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
      const t = document.querySelector('.vacp-debug-ui-meta')?.textContent ?? '';
      return /mode=inspect/.test(t);
    });

    const meta = page.locator('.vacp-debug-ui-meta');
    const entry = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]').first();
    await expect(entry).toBeVisible();
    const idxText = await entry.getAttribute('data-index');
    const idx = Number(idxText);
    expect(Number.isFinite(idx)).toBeTruthy();

    const before = parseMeta(await meta.innerText());
    await entry.click();
    await page.waitForFunction(
      ({ expectedCursor }) => {
        const t = document.querySelector('.vacp-debug-ui-meta')?.textContent ?? '';
        const mode = t.match(/mode=(\w+)/)?.[1];
        const cursor = t.match(/cursor=(-?\d+)/)?.[1];
        return mode === 'inspect' && Number(cursor) === expectedCursor;
      },
      { expectedCursor: idx },
    );

    await page.waitForTimeout(700);

    const after = parseMeta(await meta.innerText());
    expect(after.mode).toBe('inspect');
    expect(after.history).toBe(before.history);
  } finally {
    await srv.stop();
  }
});
