import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ViewRect = Rect & { innerWidth: number; innerHeight: number };

const DOCK_MARGIN = 14;
const DOCK_GAP = 8;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function dockLeftBounds(rect: ViewRect): { min: number; max: number } {
  return { min: DOCK_MARGIN, max: Math.max(DOCK_MARGIN, rect.innerWidth - rect.width - DOCK_MARGIN) };
}

function expectedDockLeftAfterDrag(rect: ViewRect, fromX: number, toX: number): number {
  const bounds = dockLeftBounds(rect);
  return clamp(rect.left + toX - fromX, bounds.min, bounds.max);
}

async function getRootRect(page: Page): Promise<ViewRect> {
  return await page.evaluate(() => {
    const el = document.getElementById('vacp-debug-ui-root');
    if (!el) throw new Error('Missing #vacp-debug-ui-root');
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
}

async function getPanelRect(page: Page): Promise<ViewRect> {
  return await page.evaluate(() => {
    const el = document.getElementById('vacp-debug-ui-panel');
    if (!el) throw new Error('Missing #vacp-debug-ui-panel');
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
}

async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function expectDockNearLeft(page: Page, expectedLeft: number): Promise<void> {
  const rect = await getRootRect(page);
  const expectedTop = rect.innerHeight - rect.height - DOCK_MARGIN;
  const dx = Math.abs(rect.left - expectedLeft);
  const dy = Math.abs(rect.top - expectedTop);
  expect(dx, `dock left delta=${dx} expected ${expectedLeft} got ${rect.left}`).toBeLessThanOrEqual(4);
  expect(dy, `dock top delta=${dy} expected ${expectedTop} got ${rect.top}`).toBeLessThanOrEqual(3);
}

async function expectPanelAttached(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    if (!panel) return false;
    return panel
      .getAnimations()
      .every((animation) => animation.playState === 'finished' || animation.playState === 'idle');
  });

  const [dock, panel] = await Promise.all([getRootRect(page), getPanelRect(page)]);
  expect(panel.left, `panel left=${panel.left}`).toBeGreaterThanOrEqual(DOCK_MARGIN - 1);
  expect(panel.top, `panel top=${panel.top}`).toBeGreaterThanOrEqual(DOCK_MARGIN - 1);
  expect(panel.right, `panel right=${panel.right}`).toBeLessThanOrEqual(panel.innerWidth - DOCK_MARGIN + 1);
  expect(panel.bottom, `panel bottom=${panel.bottom}`).toBeLessThanOrEqual(dock.top - DOCK_GAP + 2);
  expect(panel.bottom, `panel bottom=${panel.bottom}`).toBeGreaterThanOrEqual(dock.top - DOCK_GAP - 2);

  const dockCenter = dock.left + dock.width / 2;
  expect(dockCenter, `dock center=${dockCenter}`).toBeGreaterThanOrEqual(panel.left - 1);
  expect(dockCenter, `dock center=${dockCenter}`).toBeLessThanOrEqual(panel.right + 1);
  await expect(page.locator('.vacp-debug-ui-connector')).toHaveCount(0);
}

async function expectNoShortcutLabels(page: Page): Promise<void> {
  const panel = page.locator('#vacp-debug-ui-panel');
  await expect(panel).not.toContainText(/Alt\s+\d/);
  const navText = await page.locator('.vacp-debug-ui-nav-list').innerText();
  expect(navText).not.toMatch(/Alt\s+\d/);
}

test('debug-ui: dock drags freely and keeps the panel attached without shortcut labels', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText('');

    const startDock = await getRootRect(page);
    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error('Missing pill bounding box');
    const firstFrom = { x: pillBox.x + pillBox.width / 2, y: pillBox.y + pillBox.height / 2 };
    const firstTo = { x: page.viewportSize()!.width * 0.43, y: firstFrom.y };
    await dragFromTo(page, firstFrom, firstTo);
    await page.waitForTimeout(60);
    await expectDockNearLeft(page, expectedDockLeftAfterDrag(startDock, firstFrom.x, firstTo.x));

    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
    await expectPanelAttached(page);
    await expectNoShortcutLabels(page);

    const header = page.locator('.vacp-debug-ui-topbar');
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error('Missing panel header bounding box');
    const dockBeforeHeaderDrag = await getRootRect(page);
    const secondFrom = { x: headerBox.x + headerBox.width / 2, y: headerBox.y + headerBox.height / 2 };
    const secondTo = { x: page.viewportSize()!.width * 0.64, y: secondFrom.y };
    await dragFromTo(page, secondFrom, secondTo);
    await page.waitForTimeout(60);
    await expectDockNearLeft(page, expectedDockLeftAfterDrag(dockBeforeHeaderDrag, secondFrom.x, secondTo.x));
    await expectPanelAttached(page);
    await expectNoShortcutLabels(page);

    const resizeHandle = page.locator('.vacp-debug-ui-resize-n');
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) throw new Error('Missing resize handle bounding box');
    await dragFromTo(
      page,
      { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + 3 },
      { x: resizeBox.x + resizeBox.width / 2, y: Math.max(1, resizeBox.y - 80) },
    );
    await page.waitForTimeout(120);
    await expectPanelAttached(page);

    await expect(page.locator('.vacp-debug-ui-diagram svg')).toBeVisible({ timeout: 15_000 });

    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toHaveAttribute('data-state', 'closing');
    await expect(page.locator('.vacp-debug-ui-connector')).toHaveCount(0);
    await expect(page.locator('#vacp-debug-ui-panel')).toBeHidden({ timeout: 1_000 });
  } finally {
    await srv.stop();
  }
});
