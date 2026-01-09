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

test('debug-ui: history undo/redo updates time travel cursor', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vanilla-minimal', cwd: resolve(examplesDir, 'vanilla-minimal') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    // Mermaid graph should default to left-to-right.
    await expect(page.locator('[data-vacp-graph="1"]')).toHaveAttribute('data-vacp-direction', 'LR');
    await expect(page.locator('.vacp-debug-ui-diagram svg')).toBeVisible({ timeout: 15_000 });

    // Create a few history entries with state snapshots.
    await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;
      if (!b || typeof b.refresh !== 'function') throw new Error('Missing bridge.refresh');
      await b.refresh({ source: 'debug', message: 't0' });
      await b.refresh({ source: 'debug', message: 't1' });
      await b.refresh({ source: 'debug', message: 't2' });
    });

    const historyTab = page.locator('.vacp-debug-ui-module', { hasText: 'History' });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
      const m = t.match(/history=(\d+)/);
      return m && Number(m[1]) >= 3;
    });

    const beforeTitle = await page.locator('.vacp-debug-ui-title').innerText();
    const before = parseTitle(beforeTitle);
    expect(before.history).toBeGreaterThanOrEqual(3);

    await page.locator('button[aria-label="Undo"]').click();
    await page.waitForFunction(
      ({ prevCursor }) => {
        const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
        const m = t.match(/mode=(\w+)\s+cursor=(-?\d+)/);
        if (!m) return false;
        return m[1] === 'inspect' && Number(m[2]) === prevCursor - 1;
      },
      { prevCursor: before.cursor },
    );

    const afterUndoTitle = await page.locator('.vacp-debug-ui-title').innerText();
    const afterUndo = parseTitle(afterUndoTitle);
    expect(afterUndo.mode).toBe('inspect');

    await page.locator('button[aria-label="Redo"]').click();
    await page.waitForFunction(
      ({ expectedCursor }) => {
        const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
        const m = t.match(/cursor=(-?\d+)/);
        if (!m) return false;
        return Number(m[1]) === expectedCursor;
      },
      { expectedCursor: before.cursor },
    );

    // Time travel to the first entry via the per-entry rewind control.
    const rewindButtons = page.locator('button[aria-label="Rewind to here"]');
    await expect(rewindButtons.first()).toBeVisible();
    await rewindButtons.first().click();
    await page.waitForFunction(() => {
      const t = document.querySelector('.vacp-debug-ui-title')?.textContent ?? '';
      const m = t.match(/mode=(\w+)\s+cursor=(-?\d+)/);
      if (!m) return false;
      return m[1] === 'inspect' && Number(m[2]) === 0;
    });
  } finally {
    await srv.stop();
  }
});

