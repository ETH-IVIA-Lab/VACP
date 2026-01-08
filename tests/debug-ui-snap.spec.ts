import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

type Rect = { left: number; top: number; width: number; height: number; innerWidth: number; innerHeight: number };
type PanelRect = { left: number; top: number; right: number; bottom: number; innerWidth: number; innerHeight: number };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function expectedAnchor(rect: Rect, anchor: 'top-left' | 'center' | 'bottom-right'): { left: number; top: number } {
  const margin = 10;
  const right = Math.max(margin, rect.innerWidth - rect.width - margin);
  const bottom = Math.max(margin, rect.innerHeight - rect.height - margin);
  const centerX = clamp((rect.innerWidth - rect.width) / 2, margin, right);
  const centerY = clamp((rect.innerHeight - rect.height) / 2, margin, bottom);
  if (anchor === 'top-left') return { left: margin, top: margin };
  if (anchor === 'bottom-right') return { left: right, top: bottom };
  return { left: centerX, top: centerY };
}

async function getRootRect(page: Page): Promise<Rect> {
  return await page.evaluate(() => {
    const el = document.getElementById('vacp-debug-ui-root');
    if (!el) throw new Error('Missing #vacp-debug-ui-root');
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
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

async function expectNear(page: Page, anchor: 'top-left' | 'center' | 'bottom-right'): Promise<void> {
  const rect = await getRootRect(page);
  const exp = expectedAnchor(rect, anchor);
  const dx = Math.abs(rect.left - exp.left);
  const dy = Math.abs(rect.top - exp.top);
  expect(dx, `left delta=${dx} (expected ${exp.left}, got ${rect.left})`).toBeLessThanOrEqual(14);
  expect(dy, `top delta=${dy} (expected ${exp.top}, got ${rect.top})`).toBeLessThanOrEqual(14);
}

async function getPanelRect(page: Page): Promise<PanelRect> {
  return await page.evaluate(() => {
    const el = document.getElementById('vacp-debug-ui-panel');
    if (!el) throw new Error('Missing #vacp-debug-ui-panel');
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
}

async function expectPanelWithinViewport(page: Page): Promise<void> {
  const r = await getPanelRect(page);
  const margin = 10;
  expect(r.left, `panel left=${r.left}`).toBeGreaterThanOrEqual(margin - 1);
  expect(r.top, `panel top=${r.top}`).toBeGreaterThanOrEqual(margin - 1);
  expect(r.right, `panel right=${r.right}`).toBeLessThanOrEqual(r.innerWidth - margin + 1);
  expect(r.bottom, `panel bottom=${r.bottom}`).toBeLessThanOrEqual(r.innerHeight - margin + 1);
}

test('debug-ui: drag snaps to anchors', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'vanilla-minimal', cwd: resolve(examplesDir, 'vanilla-minimal') });
  try {
    await page.goto(`${srv.url}?vacpDebug=1`, { waitUntil: 'domcontentloaded' });

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();

    // Drag the closed pill near the center; it should snap to the draggable grid.
    const box = await pill.boundingBox();
    if (!box) throw new Error('Missing pill bounding box');
    await dragFromTo(
      page,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: page.viewportSize()!.width / 2, y: page.viewportSize()!.height / 2 },
    );
    await page.waitForTimeout(260);
    await expectNear(page, 'center');

    // Drag to the extreme top-left; it should snap to the margin anchor.
    const box2 = await pill.boundingBox();
    if (!box2) throw new Error('Missing pill bounding box (2)');
    await dragFromTo(page, { x: box2.x + 8, y: box2.y + 8 }, { x: 1, y: 1 });
    await page.waitForTimeout(260);
    await expectNear(page, 'top-left');

    // Open the panel, then drag the pill and ensure the panel stays fully visible.
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    const tbox = await pill.boundingBox();
    if (!tbox) throw new Error('Missing pill bounding box (open)');
    await dragFromTo(
      page,
      { x: tbox.x + tbox.width / 2, y: tbox.y + tbox.height / 2 },
      { x: page.viewportSize()!.width - 1, y: page.viewportSize()!.height - 1 },
    );
    await page.waitForTimeout(260);
    await expectNear(page, 'bottom-right');
    await expectPanelWithinViewport(page);

    // Graph module should show a rendered diagram.
    await expect(page.locator('.vacp-debug-ui-diagram svg')).toBeVisible({ timeout: 15_000 });
  } finally {
    await srv.stop();
  }
});
