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

function expectedDock(rect: ViewRect, anchor: 'left' | 'center' | 'right'): { left: number; top: number } {
  const maxLeft = Math.max(DOCK_MARGIN, rect.innerWidth - rect.width - DOCK_MARGIN);
  const center = clamp((rect.innerWidth - rect.width) / 2, DOCK_MARGIN, maxLeft);
  if (anchor === 'left') return { left: DOCK_MARGIN, top: rect.innerHeight - rect.height - DOCK_MARGIN };
  if (anchor === 'right') return { left: maxLeft, top: rect.innerHeight - rect.height - DOCK_MARGIN };
  return { left: center, top: rect.innerHeight - rect.height - DOCK_MARGIN };
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

async function getConnectorRect(page: Page): Promise<ViewRect & { display: string }> {
  return await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.vacp-debug-ui-connector');
    if (!el) throw new Error('Missing .vacp-debug-ui-connector');
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
      display: getComputedStyle(el).display,
    };
  });
}

async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function expectDockNear(page: Page, anchor: 'left' | 'center' | 'right'): Promise<void> {
  const rect = await getRootRect(page);
  const expected = expectedDock(rect, anchor);
  const dx = Math.abs(rect.left - expected.left);
  const dy = Math.abs(rect.top - expected.top);
  expect(dx, `dock left delta=${dx} expected ${expected.left} got ${rect.left}`).toBeLessThanOrEqual(14);
  expect(dy, `dock top delta=${dy} expected ${expected.top} got ${rect.top}`).toBeLessThanOrEqual(3);
}

async function expectPanelAttached(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    const connector = document.querySelector<HTMLElement>('.vacp-debug-ui-connector');
    if (!panel || !connector) return false;
    const animations = [...panel.getAnimations(), ...connector.getAnimations()];
    return animations.every((animation) => animation.playState === 'finished' || animation.playState === 'idle');
  });

  const [dock, panel, connector] = await Promise.all([getRootRect(page), getPanelRect(page), getConnectorRect(page)]);
  expect(panel.left, `panel left=${panel.left}`).toBeGreaterThanOrEqual(DOCK_MARGIN - 1);
  expect(panel.top, `panel top=${panel.top}`).toBeGreaterThanOrEqual(DOCK_MARGIN - 1);
  expect(panel.right, `panel right=${panel.right}`).toBeLessThanOrEqual(panel.innerWidth - DOCK_MARGIN + 1);
  expect(panel.bottom, `panel bottom=${panel.bottom}`).toBeLessThanOrEqual(dock.top - DOCK_GAP + 2);
  expect(panel.bottom, `panel bottom=${panel.bottom}`).toBeGreaterThanOrEqual(dock.top - DOCK_GAP - 2);

  const connectorCenter = connector.left + connector.width / 2;
  const dockCenter = dock.left + dock.width / 2;
  expect(connector.display, 'connector display').toBe('block');
  expect(connector.width, `connector width=${connector.width}`).toBeGreaterThan(0);
  expect(connector.height, `connector height=${connector.height}`).toBeGreaterThan(0);
  expect(connector.top, `connector top=${connector.top}`).toBeGreaterThanOrEqual(panel.bottom - 1);
  expect(connector.bottom, `connector bottom=${connector.bottom}`).toBeLessThanOrEqual(dock.top + 1);
  expect(connectorCenter, `connector center=${connectorCenter}`).toBeGreaterThanOrEqual(panel.left + 20);
  expect(connectorCenter, `connector center=${connectorCenter}`).toBeLessThanOrEqual(panel.right - 20);
  expect(Math.abs(connectorCenter - dockCenter), `connector center delta=${connectorCenter - dockCenter}`).toBeLessThanOrEqual(
    1,
  );
}

test('debug-ui: dock snaps on the bottom rail and keeps the panel attached', async ({ page }) => {
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

    const pillBox = await pill.boundingBox();
    if (!pillBox) throw new Error('Missing pill bounding box');
    await dragFromTo(
      page,
      { x: pillBox.x + pillBox.width / 2, y: pillBox.y + pillBox.height / 2 },
      { x: page.viewportSize()!.width / 2, y: 10 },
    );
    await page.waitForTimeout(220);
    await expectDockNear(page, 'center');

    const centerBox = await pill.boundingBox();
    if (!centerBox) throw new Error('Missing centered pill bounding box');
    await dragFromTo(page, { x: centerBox.x + 8, y: centerBox.y + 8 }, { x: 1, y: 1 });
    await page.waitForTimeout(220);
    await expectDockNear(page, 'left');

    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
    await expectPanelAttached(page);

    const header = page.locator('.vacp-debug-ui-topbar');
    const headerBox = await header.boundingBox();
    if (!headerBox) throw new Error('Missing panel header bounding box');
    await dragFromTo(
      page,
      { x: headerBox.x + headerBox.width / 2, y: headerBox.y + headerBox.height / 2 },
      { x: page.viewportSize()!.width - 1, y: headerBox.y + headerBox.height / 2 },
    );
    await page.waitForTimeout(220);
    await expectDockNear(page, 'right');
    await expectPanelAttached(page);

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
    await expect(page.locator('.vacp-debug-ui-connector')).toHaveAttribute('data-state', 'closing');
    await expect(page.locator('#vacp-debug-ui-panel')).toBeHidden({ timeout: 1_000 });
  } finally {
    await srv.stop();
  }
});
