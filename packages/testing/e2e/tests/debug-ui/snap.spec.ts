import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type ViewRect = Rect & { innerWidth: number; innerHeight: number };

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

async function panelDragPoint(page: Page): Promise<{ x: number; y: number }> {
  return await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-vacp-debug-panel-drag="1"]');
    if (!header) throw new Error('Missing panel header drag target');
    const rect = header.getBoundingClientRect();
    const ys = [rect.top + rect.height / 2, rect.top + 10, rect.bottom - 10];

    for (const y of ys) {
      for (let x = rect.left + 10; x <= rect.right - 10; x += 14) {
        const hit = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!hit || !(hit === header || header.contains(hit))) continue;
        const interactive = hit.closest('button, a, input, textarea, select, option, [role="button"], [role="tab"]');
        if (!interactive) return { x, y };
      }
    }

    throw new Error('No non-interactive panel header drag point found');
  });
}

function expectRectInsideViewport(rect: ViewRect, label: string): void {
  expect(rect.left, `${label} left=${rect.left}`).toBeGreaterThanOrEqual(-1);
  expect(rect.top, `${label} top=${rect.top}`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${label} right=${rect.right}`).toBeLessThanOrEqual(rect.innerWidth + 1);
  expect(rect.bottom, `${label} bottom=${rect.bottom}`).toBeLessThanOrEqual(rect.innerHeight + 1);
}

function dragTargetInsideViewport(
  rect: ViewRect,
  from: { x: number; y: number },
  preferredDeltaX: number,
): { x: number; y: number } {
  const roomRight = rect.innerWidth - rect.right - 1;
  const roomLeft = rect.left - 1;
  if (roomRight >= preferredDeltaX) return { x: from.x + preferredDeltaX, y: from.y };
  if (roomLeft >= preferredDeltaX) return { x: from.x - preferredDeltaX, y: from.y };
  throw new Error(`Dock has no ${preferredDeltaX}px in-bounds drag lane`);
}

async function expectDockMovedNear(
  page: Page,
  before: ViewRect,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const rect = await getRootRect(page);
  expectRectInsideViewport(rect, 'dock');

  const beforeCenter = before.left + before.width / 2;
  const afterCenter = rect.left + rect.width / 2;
  const requestedDelta = to.x - from.x;
  const actualDelta = afterCenter - beforeCenter;
  expect(Math.abs(actualDelta - requestedDelta), `dock delta=${actualDelta}`).toBeLessThanOrEqual(4);
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
  expectRectInsideViewport(dock, 'dock');
  expectRectInsideViewport(panel, 'panel');

  const gap = dock.top - panel.bottom;
  expect(gap, `panel-dock gap=${gap}`).toBeGreaterThanOrEqual(-1);
  expect(gap, `panel-dock gap=${gap}`).toBeLessThanOrEqual(24);

  const dockCenter = dock.left + dock.width / 2;
  expect(dockCenter, `dock center=${dockCenter}`).toBeGreaterThanOrEqual(panel.left - 1);
  expect(dockCenter, `dock center=${dockCenter}`).toBeLessThanOrEqual(panel.right + 1);
}

async function expectDockHasNoVisibleText(page: Page): Promise<void> {
  const visibleText = await page.locator('button.vacp-debug-ui-button').evaluate((button) => {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    const chunks: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      const rects = parent.getClientRects();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rects.length > 0;
      if (visible) chunks.push(text);
    }
    return chunks.join(' ');
  });
  expect(visibleText).toBe('');
}

test('debug-ui: dock drags freely and keeps the panel attached', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAccessibleName(/vacp bridge.*debug tools/i);
    await expectDockHasNoVisibleText(page);

    const startDock = await getRootRect(page);
    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error('Missing pill bounding box');
    const firstFrom = { x: pillBox.x + pillBox.width / 2, y: pillBox.y + pillBox.height / 2 };
    const firstTo = dragTargetInsideViewport(startDock, firstFrom, 120);
    await dragFromTo(page, firstFrom, firstTo);
    await page.waitForTimeout(60);
    await expectDockMovedNear(page, startDock, firstFrom, firstTo);

    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
    await expectPanelAttached(page);

    const dockBeforeHeaderDrag = await getRootRect(page);
    const secondFrom = await panelDragPoint(page);
    const secondTo = dragTargetInsideViewport(dockBeforeHeaderDrag, secondFrom, 120);
    await dragFromTo(page, secondFrom, secondTo);
    await page.waitForTimeout(60);
    await expectDockMovedNear(page, dockBeforeHeaderDrag, secondFrom, secondTo);
    await expectPanelAttached(page);

    const resizeHandle = page.locator('[data-vacp-debug-resize-handle="n"]');
    const resizeBox = await resizeHandle.boundingBox();
    if (!resizeBox) throw new Error('Missing resize handle bounding box');
    await dragFromTo(
      page,
      { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + 3 },
      { x: resizeBox.x + resizeBox.width / 2, y: Math.max(1, resizeBox.y - 80) },
    );
    await page.waitForTimeout(120);
    await expectPanelAttached(page);

    await expect(page.locator('[data-vacp-graph-flow="1"] .react-flow__node').first()).toBeVisible({
      timeout: 15_000,
    });

    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeHidden({ timeout: 1_000 });
  } finally {
    await srv.stop();
  }
});

test('debug-ui: compact saved panel exposes a header drag target', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);
    await page.evaluate(() => {
      localStorage.removeItem('vacp:debug:dock');
      localStorage.setItem('vacp:debug:size', JSON.stringify({ width: 360, height: 520 }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
    await expect
      .poll(async () => {
        return await page.locator('#vacp-debug-ui-panel').evaluate((panel) => panel.getBoundingClientRect().width);
      })
      .toBeLessThanOrEqual(380);
    await expectPanelAttached(page);

    const dragStrip = page.locator('[data-vacp-debug-drag-strip="1"]');
    const stripBox = await dragStrip.boundingBox();
    if (!stripBox) throw new Error('Missing compact drag strip bounding box');
    const stripReceivesPointer = await page.evaluate(
      ({ x, y }) => {
        const strip = document.querySelector('[data-vacp-debug-drag-strip="1"]');
        const hit = document.elementFromPoint(x, y);
        return Boolean(strip && hit && (strip === hit || strip.contains(hit)));
      },
      {
        x: stripBox.x + stripBox.width / 2,
        y: stripBox.y + stripBox.height / 2,
      },
    );
    expect(stripReceivesPointer).toBe(true);
    const dockBeforeCompactDrag = await getRootRect(page);
    const compactFrom = { x: stripBox.x + stripBox.width / 2, y: stripBox.y + stripBox.height / 2 };
    const compactTo = dragTargetInsideViewport(dockBeforeCompactDrag, compactFrom, 80);
    await dragFromTo(page, compactFrom, compactTo);
    await page.waitForTimeout(60);
    await expectDockMovedNear(page, dockBeforeCompactDrag, compactFrom, compactTo);
    await expectPanelAttached(page);
  } finally {
    await srv.stop();
  }
});
