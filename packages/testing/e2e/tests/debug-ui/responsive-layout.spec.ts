import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { chatScrollState, runtimeId, seedDebugChatThreadOnNextLoad, waitForVacpBridge } from './helpers';

const MODULES = ['Graph', 'Data', 'Actions', 'History', 'Chat', 'Settings', 'JSON'] as const;
const COMPACT_READY_THREAD_ID = 'thread:responsive-ready-chat';
const COMPACT_READY_QUESTION = 'summarize the active chart and cite the visible evidence';
const COMPACT_READY_ANSWER = Array.from(
  { length: 60 },
  (_, idx) =>
    `Evidence note ${idx + 1}: describe the active visualization, preserve the analytical context, and keep the transcript tall enough to exercise compact panel scrolling.`,
).join('\n\n');
const COMPACT_READY_VIEWPORTS = [
  { name: 'mobile-ready', width: 430, height: 820, runtimeId: '00000000-0000-4000-8000-000000000201' },
  { name: 'narrow-ready', width: 360, height: 800, runtimeId: '00000000-0000-4000-8000-000000000202' },
] as const;
const COMPACT_SETUP_VIEWPORTS = [
  { name: 'mobile-setup', width: 430, height: 820 },
  { name: 'narrow-setup', width: 360, height: 800 },
] as const;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1050 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 430, height: 820 },
  { name: 'narrow-mobile', width: 360, height: 800 },
] as const;

const GEOMETRY_EPSILON = 1;

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

async function openDebugUi(
  page: Page,
  url: string,
  options?: { savedSize?: { width: number; height: number } },
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForVacpBridge(page);
  await page.evaluate((savedSize) => {
    localStorage.removeItem('vacp:debug:size');
    localStorage.removeItem('vacp:debug:dock');
    if (savedSize) localStorage.setItem('vacp:debug:size', JSON.stringify(savedSize));
  }, options?.savedSize ?? null);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForVacpBridge(page);

  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
}

async function overlayMetrics(page: Page): Promise<{
  panel: Rect;
  panelOverflowX: boolean;
  activeTabOverflowX: boolean;
  tabs: Rect[];
}> {
  const metrics = await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    if (!panel) throw new Error('Missing debug UI panel');
    const panelRect = panel.getBoundingClientRect();
    const rect = (r: DOMRect): Rect => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    const tabs = [...panel.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) =>
      rect(tab.getBoundingClientRect()),
    );
    return {
      panel: rect(panelRect),
      panelOverflowX: panel.scrollWidth > panel.clientWidth + 1,
      tabs,
    };
  });
  return {
    ...metrics,
    activeTabOverflowX: await selectedTabpanelOverflowX(page),
  };
}

type OverlayMetrics = Awaited<ReturnType<typeof overlayMetrics>>;
type HorizontalOverflowMetrics = Pick<OverlayMetrics, 'panelOverflowX' | 'activeTabOverflowX'>;

async function expectCompactPanelWidth(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      return await page.locator('#vacp-debug-ui-panel').evaluate((panel) => panel.getBoundingClientRect().width);
    })
    .toBeLessThanOrEqual(380);
}

async function selectedTabpanelOverflowX(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    if (!panel) throw new Error('Missing debug UI panel');
    const selectedTab = panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const controls = selectedTab?.getAttribute('aria-controls');
    const tabpanel = controls ? document.getElementById(controls) : null;
    if (!(tabpanel instanceof HTMLElement) || tabpanel.getAttribute('role') !== 'tabpanel' || !panel.contains(tabpanel)) {
      throw new Error('Missing selected debug UI tabpanel');
    }
    return tabpanel.scrollWidth > tabpanel.clientWidth + 1;
  });
}

async function expectSelectedModule(page: Page, moduleName: (typeof MODULES)[number], scope: string): Promise<void> {
  const tab = page.getByRole('tab', { name: moduleName });
  await expect(tab, `${scope} tab selected`).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: moduleName }), `${scope} tabpanel visible`).toBeVisible();
}

async function navLabelState(page: Page): Promise<
  Array<{
    label: string;
    visible: boolean;
  }>
> {
  return await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    if (!panel) throw new Error('Missing debug UI panel');
    return [...panel.querySelectorAll<HTMLElement>('[data-vacp-debug-nav-label]')].map((label) => {
      const labelRect = label.getBoundingClientRect();
      const labelStyle = getComputedStyle(label);
      return {
        label: label.textContent?.trim() ?? '',
        visible:
          labelRect.width > 4 &&
          labelRect.height > 4 &&
          labelStyle.visibility !== 'hidden' &&
          labelStyle.display !== 'none',
      };
    });
  });
}

async function expectNavLabels(page: Page, expected: 'visible' | 'icon-only', scope: string): Promise<void> {
  await expect
    .poll(async () => navLabelsMatch(await navLabelState(page), expected), { message: `${scope} nav label state` })
    .toBe(true);

  const labels = await navLabelState(page);
  expect(
    labels.map((item) => item.label),
    `${scope} labels`,
  ).toEqual([...MODULES]);
  for (const item of labels) {
    if (expected === 'visible') {
      expect(item.visible, `${scope}:${item.label} label visible`).toBe(true);
    } else {
      expect(item.visible, `${scope}:${item.label} label hidden`).toBe(false);
    }
  }
}

async function compactReadyChatMetrics(page: Page): Promise<{
  panel: Rect;
  input: Rect;
  panelOverflowX: boolean;
  tabpanelOverflowX: boolean;
}> {
  const metrics = await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    const input = document.querySelector<HTMLElement>('[data-vacp-chat-input="1"]');
    if (!panel || !input) throw new Error('Missing ready chat layout nodes');
    const rect = (r: DOMRect): Rect => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    return {
      panel: rect(panel.getBoundingClientRect()),
      input: rect(input.getBoundingClientRect()),
      panelOverflowX: panel.scrollWidth > panel.clientWidth + 1,
    };
  });
  return {
    ...metrics,
    tabpanelOverflowX: await selectedTabpanelOverflowX(page),
  };
}

async function compactChatSetupMetrics(page: Page): Promise<{
  panel: Rect;
  settings: Rect;
  panelOverflowX: boolean;
  activeTabOverflowX: boolean;
}> {
  const metrics = await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    const settings = document.querySelector<HTMLElement>('[data-vacp-chat-settings-panel="1"]');
    if (!panel || !settings) throw new Error('Missing chat setup layout nodes');
    const rect = (r: DOMRect): Rect => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    return {
      panel: rect(panel.getBoundingClientRect()),
      settings: rect(settings.getBoundingClientRect()),
      panelOverflowX: panel.scrollWidth > panel.clientWidth + 1,
    };
  });
  return {
    ...metrics,
    activeTabOverflowX: await selectedTabpanelOverflowX(page),
  };
}

function navLabelsMatch(labels: Awaited<ReturnType<typeof navLabelState>>, expected: 'visible' | 'icon-only'): boolean {
  if (labels.length !== MODULES.length) return false;
  if (expected === 'visible') {
    return labels.every((item) => item.visible);
  }
  return labels.every((item) => !item.visible);
}

function expectRectInside(inner: Rect, outer: Rect, scope: string): void {
  expect(inner.left, `${scope} left`).toBeGreaterThanOrEqual(outer.left - GEOMETRY_EPSILON);
  expect(inner.top, `${scope} top`).toBeGreaterThanOrEqual(outer.top - GEOMETRY_EPSILON);
  expect(inner.right, `${scope} right`).toBeLessThanOrEqual(outer.right + GEOMETRY_EPSILON);
  expect(inner.bottom, `${scope} bottom`).toBeLessThanOrEqual(outer.bottom + GEOMETRY_EPSILON);
}

function expectPanelInsideViewport(panel: Rect, viewport: ViewportSize, scope: string): void {
  expect(panel.left, `${scope} panel left`).toBeGreaterThanOrEqual(-GEOMETRY_EPSILON);
  expect(panel.top, `${scope} panel top`).toBeGreaterThanOrEqual(-GEOMETRY_EPSILON);
  expect(panel.right, `${scope} panel right`).toBeLessThanOrEqual(viewport.width + GEOMETRY_EPSILON);
  expect(panel.bottom, `${scope} panel bottom`).toBeLessThanOrEqual(viewport.height + GEOMETRY_EPSILON);
}

function expectNoHorizontalOverflow(metrics: HorizontalOverflowMetrics, scope: string): void {
  expect(metrics.panelOverflowX, `${scope} panel overflow`).toBe(false);
  expect(metrics.activeTabOverflowX, `${scope} tabpanel overflow`).toBe(false);
}

function expectModuleTabsReachable(metrics: OverlayMetrics, scope: string): void {
  expect(metrics.tabs.length, `${scope} tab count`).toBe(MODULES.length);
  for (const tab of metrics.tabs) {
    expectRectInside(tab, metrics.panel, `${scope} tab`);
  }
}

function expectModulePanelContained(metrics: OverlayMetrics, viewport: ViewportSize, scope: string): void {
  expectPanelInsideViewport(metrics.panel, viewport, scope);
  expectNoHorizontalOverflow(metrics, scope);
  expectModuleTabsReachable(metrics, scope);
}

async function expectControlReachableInsidePanel(page: Page, selector: string, scope: string): Promise<void> {
  const control = page.locator(selector).first();
  await expect(control, scope).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  const [panelBox, controlBox] = await Promise.all([
    page.locator('#vacp-debug-ui-panel').boundingBox(),
    control.boundingBox(),
  ]);
  if (!panelBox || !controlBox) throw new Error(`Missing layout box for ${scope}`);
  const panel: Rect = {
    left: panelBox.x,
    top: panelBox.y,
    right: panelBox.x + panelBox.width,
    bottom: panelBox.y + panelBox.height,
    width: panelBox.width,
    height: panelBox.height,
  };
  const rect: Rect = {
    left: controlBox.x,
    top: controlBox.y,
    right: controlBox.x + controlBox.width,
    bottom: controlBox.y + controlBox.height,
    width: controlBox.width,
    height: controlBox.height,
  };
  expectRectInside(rect, panel, scope);
}

async function subheaderHeight(page: Page, moduleName: (typeof MODULES)[number], selector: string): Promise<number> {
  const tab = page.getByRole('tab', { name: moduleName });
  await tab.click();
  await expectSelectedModule(page, moduleName, moduleName);
  const subheader = page.locator(selector);
  await expect(subheader, `${moduleName} subheader`).toBeVisible();
  const box = await subheader.boundingBox();
  if (!box) throw new Error(`Missing ${moduleName} subheader box`);
  return box.height;
}

async function expectPanelSize(page: Page, expected: { width: number; height: number }, scope: string): Promise<void> {
  await expect
    .poll(async () => {
      return await page.locator('#vacp-debug-ui-panel').evaluate((panel) => {
        const rect = panel.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      });
    }, { message: `${scope} panel size` })
    .toEqual(expected);
}

test('debug-ui: compact navigation fits every module at supported viewports', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vega-lite-gallery',
    cwd: exampleDir('vega-lite-gallery'),
  });

  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openDebugUi(page, srv.url);
      if (viewport.name === 'desktop') await expectNavLabels(page, 'visible', viewport.name);
      if (viewport.name === 'mobile') await expectNavLabels(page, 'icon-only', viewport.name);

      for (const moduleName of MODULES) {
        const tab = page.getByRole('tab', { name: moduleName });
        await expect(tab, `${viewport.name}:${moduleName}`).toBeVisible();
        await tab.click();
        await expectSelectedModule(page, moduleName, `${viewport.name}:${moduleName}`);

        const metrics = await overlayMetrics(page);
        expectModulePanelContained(metrics, viewport, `${viewport.name}:${moduleName}`);
      }
    }
  } finally {
    await srv.stop();
  }
});

test('debug-ui: resized desktop panel keeps every module tab reachable', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vega-lite-gallery',
    cwd: exampleDir('vega-lite-gallery'),
  });

  try {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await openDebugUi(page, srv.url, { savedSize: { width: 360, height: 520 } });
    await expectCompactPanelWidth(page);
    await expectNavLabels(page, 'icon-only', 'desktop-resized');

    for (const moduleName of MODULES) {
      const tab = page.getByRole('tab', { name: moduleName });
      await expect(tab, `desktop-resized:${moduleName}`).toBeVisible();
      await tab.click();
      await expectSelectedModule(page, moduleName, `desktop-resized:${moduleName}`);

      const metrics = await overlayMetrics(page);
      expectModulePanelContained(metrics, { width: 1440, height: 1050 }, `desktop-resized:${moduleName}`);
    }
  } finally {
    await srv.stop();
  }
});

test('debug-ui: chat uses the same compact subheader rhythm as events', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    const testRuntimeId = '00000000-0000-4000-8000-000000000203';
    await page.setViewportSize({ width: 1440, height: 1050 });
    await seedDebugChatThreadOnNextLoad(page, {
      runtimeId: testRuntimeId,
      threadId: `${COMPACT_READY_THREAD_ID}:subheader-rhythm`,
      question: COMPACT_READY_QUESTION,
      answer: 'The visible plot shows a basketball shot chart.',
      label: 'wnba-shots',
      sessionKey: 'vgplot/wnba-shots',
      viewRef: 'vacp://vacp-examples/vgplot/wnba-shots',
      vizRef: 'vacp://vacp-examples/vgplot/wnba-shots/plot-0',
    });
    await openDebugUi(page, `${srv.url}?vacp-debug=1&vacp-runtime-id=${testRuntimeId}#wnba-shots`, {
      savedSize: { width: 880, height: 560 },
    });
    await expectPanelSize(page, { width: 880, height: 560 }, 'saved-size subheader rhythm');

    const eventsHeight = await subheaderHeight(page, 'History', '[data-vacp-history-subheader="1"]');
    const chatHeight = await subheaderHeight(page, 'Chat', '[data-vacp-chat-subheader="1"]');

    expect(chatHeight, 'Chat subheader height').toBeLessThanOrEqual(eventsHeight + 4);
  } finally {
    await srv.stop();
  }
});

for (const viewport of COMPACT_SETUP_VIEWPORTS) {
  test(`debug-ui: chat setup controls stay reachable inside the ${viewport.name} overlay`, async ({ page }) => {
    const srv = await startViteDevServer({
      name: 'vega-lite-gallery',
      cwd: exampleDir('vega-lite-gallery'),
    });

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openDebugUi(page, srv.url);
      await page.getByRole('tab', { name: 'Chat' }).click();
      await expect(page.locator('[data-vacp-chat-settings-panel="1"]')).toBeVisible({ timeout: 15_000 });

      const metrics = await compactChatSetupMetrics(page);
      expectRectInside(metrics.settings, metrics.panel, `${viewport.name} chat setup settings`);
      expectNoHorizontalOverflow(
        { panelOverflowX: metrics.panelOverflowX, activeTabOverflowX: metrics.activeTabOverflowX },
        `${viewport.name} chat setup`,
      );

      await expectControlReachableInsidePanel(page, '[data-vacp-chat-provider="1"]', `${viewport.name} provider`);
      await expectControlReachableInsidePanel(page, '[data-vacp-chat-model-select="1"]', `${viewport.name} model`);
      await expectControlReachableInsidePanel(page, '[data-vacp-chat-baseurl="1"]', `${viewport.name} base URL`);
      await expectControlReachableInsidePanel(page, '[data-vacp-chat-apikey="1"]', `${viewport.name} API key`);

      await page.locator('[data-vacp-chat-settings-panel="1"] summary', { hasText: 'Advanced' }).click();
      await expectControlReachableInsidePanel(page, '[data-vacp-chat-model="1"]', `${viewport.name} manual model`);
      await expectControlReachableInsidePanel(
        page,
        '[data-vacp-chat-provider-name="1"]',
        `${viewport.name} provider name`,
      );
      await expectControlReachableInsidePanel(page, '[data-vacp-chat-maxsteps="1"]', `${viewport.name} max steps`);
      await expectControlReachableInsidePanel(
        page,
        '[data-vacp-chat-max-output-tokens="1"]',
        `${viewport.name} max output tokens`,
      );
      await expectControlReachableInsidePanel(
        page,
        '[data-vacp-chat-temperature="1"]',
        `${viewport.name} temperature`,
      );
    } finally {
      await srv.stop();
    }
  });
}

for (const viewport of COMPACT_READY_VIEWPORTS) {
  test(`debug-ui: compact ready chat stays usable inside the ${viewport.name} overlay`, async ({ page }) => {
    const srv = await startViteDevServer({
      name: 'vgplot-gallery',
      cwd: exampleDir('vgplot-gallery'),
    });

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedDebugChatThreadOnNextLoad(page, {
        runtimeId: viewport.runtimeId,
        threadId: `${COMPACT_READY_THREAD_ID}:${viewport.name}`,
        question: COMPACT_READY_QUESTION,
        answer: COMPACT_READY_ANSWER,
        label: 'wnba-shots',
        sessionKey: 'vgplot/wnba-shots',
        viewRef: 'vacp://vacp-examples/vgplot/wnba-shots',
        vizRef: 'vacp://vacp-examples/vgplot/wnba-shots/plot-0',
        clearLayoutStorage: true,
      });
      await page.goto(`${srv.url}?vacp-debug=1&vacp-runtime-id=${viewport.runtimeId}#wnba-shots`, {
        waitUntil: 'domcontentloaded',
      });
      await waitForVacpBridge(page, { requireRuntime: true });
      await expect.poll(async () => await runtimeId(page)).toBe(viewport.runtimeId);

      const pill = page.locator('button.vacp-debug-ui-button');
      await expect(pill).toBeVisible();
      await pill.click();
      await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

      await page.getByRole('tab', { name: 'Chat' }).click();
      await expect(page.locator('[data-vacp-chat-input="1"]')).toBeVisible();

      const layout = await compactReadyChatMetrics(page);
      expectRectInside(layout.input, layout.panel, `${viewport.name} chat input`);
      expect(layout.panelOverflowX).toBe(false);
      expect(layout.tabpanelOverflowX).toBe(false);

      await expect
        .poll(async () => await chatScrollState(page))
        .toMatchObject({ overflow: true, outerScrollMoved: false });

      const scrollerBox = await page.locator('[data-vacp-chat-msgs="1"]').boundingBox();
      if (!scrollerBox) throw new Error('Missing chat scroller box');
      await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);
      await page.mouse.wheel(0, -10_000);

      await expect
        .poll(async () => await chatScrollState(page))
        .toMatchObject({ atTop: true, firstUserVisible: true, outerScrollMoved: false });

      const jumpToLatest = page.getByRole('button', { name: 'Jump to latest' });
      await expect(jumpToLatest).toBeVisible();
      await jumpToLatest.click();
      await expect
        .poll(async () => await chatScrollState(page))
        .toMatchObject({ overflow: true, atBottom: true, outerScrollMoved: false });
    } finally {
      await srv.stop();
    }
  });
}
