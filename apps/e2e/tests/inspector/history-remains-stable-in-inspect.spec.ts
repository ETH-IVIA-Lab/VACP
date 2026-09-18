import { expect, test } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { inspectorRuntimeState, waitForRuntimeMode, waitForVacpBridge } from './helpers';

test('inspector: inspect mode keeps history length stable (Seattle Weather)', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

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
      const r = document
        .querySelector('#app')
        ?.querySelector('svg')
        ?.querySelector('rect.selection') as SVGRectElement | null;

      if (!r) return false;
      const b = r.getBBox();

      return b.width > 2 && b.height > 2;
    });
    await brush(0.6, 0.9);

    const pill = page.locator('button.vacp-inspector-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-inspector-panel')).toBeVisible();

    const historyTab = page.getByRole('tab', { name: 'History' });
    await expect(historyTab).toBeVisible();
    await historyTab.click();

    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('[data-vacp-row="history-entry"][data-has-state="true"]');

      return rows.length >= 2;
    });

    await page.locator('button[aria-label="Undo"]').click();
    await waitForRuntimeMode(page, 'inspect');

    const current = await inspectorRuntimeState(page);
    await expect(
      page.locator(`[data-vacp-row="history-entry"][data-index="${current.cursor}"]`).getByText('cursor'),
    ).toBeVisible();
    const stateEntries = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]');
    let targetOrdinal = -1;
    let targetIdx = -1;
    const stateEntryCount = await stateEntries.count();

    for (let i = 0; i < stateEntryCount; i++) {
      const idx = Number(await stateEntries.nth(i).getAttribute('data-index'));

      if (Number.isFinite(idx) && idx !== current.cursor) {
        targetOrdinal = i;
        targetIdx = idx;
        break;
      }
    }

    expect(targetOrdinal).toBeGreaterThanOrEqual(0);
    await stateEntries.nth(targetOrdinal).click();
    await expect
      .poll(async () => await inspectorRuntimeState(page))
      .toMatchObject({ mode: 'inspect', cursor: targetIdx });

    const before = await inspectorRuntimeState(page);
    await page.waitForTimeout(700);

    const after = await inspectorRuntimeState(page);
    expect(after.mode).toBe('inspect');
    expect(after.historyLength).toBe(before.historyLength);
  } finally {
    await srv.stop();
  }
});
