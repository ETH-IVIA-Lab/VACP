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

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1050 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 430, height: 820 },
  { name: 'narrow-mobile', width: 360, height: 800 },
] as const;

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
  return await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    if (!panel) throw new Error('Missing debug UI panel');
    const activeTab = panel.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
    if (!activeTab) throw new Error('Missing active debug UI tabpanel');
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
      activeTabOverflowX: activeTab.scrollWidth > activeTab.clientWidth + 1,
      tabs,
    };
  });
}

async function expectCompactPanelWidth(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      return await page.locator('#vacp-debug-ui-panel').evaluate((panel) => panel.getBoundingClientRect().width);
    })
    .toBeLessThanOrEqual(380);
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
  return await page.evaluate(() => {
    const panel = document.getElementById('vacp-debug-ui-panel');
    const activeTab = panel?.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
    const input = document.querySelector<HTMLElement>('[data-vacp-chat-input="1"]');
    if (!panel || !activeTab || !input) throw new Error('Missing ready chat layout nodes');
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
      tabpanelOverflowX: activeTab.scrollWidth > activeTab.clientWidth + 1,
    };
  });
}

function navLabelsMatch(labels: Awaited<ReturnType<typeof navLabelState>>, expected: 'visible' | 'icon-only'): boolean {
  if (labels.length !== MODULES.length) return false;
  if (expected === 'visible') {
    return labels.every((item) => item.visible);
  }
  return labels.every((item) => !item.visible);
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
      await expectNavLabels(
        page,
        viewport.name === 'desktop' || viewport.name === 'laptop' ? 'visible' : 'icon-only',
        viewport.name,
      );

      for (const moduleName of MODULES) {
        const tab = page.getByRole('tab', { name: moduleName });
        await expect(tab, `${viewport.name}:${moduleName}`).toBeVisible();
        await tab.click();
        await expect(tab, `${viewport.name}:${moduleName}`).toHaveAttribute('data-state', 'active');

        const metrics = await overlayMetrics(page);
        expect(metrics.panel.left, `${viewport.name}:${moduleName} left`).toBeGreaterThanOrEqual(0);
        expect(metrics.panel.top, `${viewport.name}:${moduleName} top`).toBeGreaterThanOrEqual(0);
        expect(metrics.panel.right, `${viewport.name}:${moduleName} right`).toBeLessThanOrEqual(viewport.width);
        expect(metrics.panel.bottom, `${viewport.name}:${moduleName} bottom`).toBeLessThanOrEqual(viewport.height);
        expect(metrics.panelOverflowX, `${viewport.name}:${moduleName} panel overflow`).toBe(false);
        expect(metrics.activeTabOverflowX, `${viewport.name}:${moduleName} tabpanel overflow`).toBe(false);

        expect(metrics.tabs.length, `${viewport.name}:${moduleName} tab count`).toBe(MODULES.length);
        for (const item of metrics.tabs) {
          expect(item.left, `${viewport.name}:${moduleName} tab left`).toBeGreaterThanOrEqual(metrics.panel.left);
          expect(item.right, `${viewport.name}:${moduleName} tab right`).toBeLessThanOrEqual(metrics.panel.right);
        }
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
      await expect(tab, `desktop-resized:${moduleName}`).toHaveAttribute('data-state', 'active');

      const metrics = await overlayMetrics(page);
      expect(metrics.panel.left, `desktop-resized:${moduleName} left`).toBeGreaterThanOrEqual(0);
      expect(metrics.panel.right, `desktop-resized:${moduleName} right`).toBeLessThanOrEqual(1440);
      expect(metrics.panelOverflowX, `desktop-resized:${moduleName} panel overflow`).toBe(false);
      expect(metrics.activeTabOverflowX, `desktop-resized:${moduleName} tabpanel overflow`).toBe(false);
      expect(metrics.tabs.length, `desktop-resized:${moduleName} tab count`).toBe(MODULES.length);
      for (const item of metrics.tabs) {
        expect(item.left, `desktop-resized:${moduleName} tab left`).toBeGreaterThanOrEqual(metrics.panel.left);
        expect(item.right, `desktop-resized:${moduleName} tab right`).toBeLessThanOrEqual(metrics.panel.right);
      }
    }
  } finally {
    await srv.stop();
  }
});

test('debug-ui: chat setup settings stay inside the mobile overlay', async ({ page }) => {
  const srv = await startViteDevServer({
    name: 'vega-lite-gallery',
    cwd: exampleDir('vega-lite-gallery'),
  });

  try {
    await page.setViewportSize({ width: 430, height: 820 });
    await openDebugUi(page, srv.url);
    await page.getByRole('tab', { name: 'Chat' }).click();
    await expect(page.locator('[data-vacp-chat-settings-panel="1"]')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const panel = document.getElementById('vacp-debug-ui-panel');
      const settings = document.querySelector('[data-vacp-chat-settings-panel="1"]');
      if (!panel || !settings) throw new Error('Missing embedded chat settings');
      const panelRect = panel.getBoundingClientRect();
      const settingsRect = settings.getBoundingClientRect();
      return {
        panel: {
          left: panelRect.left,
          top: panelRect.top,
          right: panelRect.right,
          bottom: panelRect.bottom,
        },
        settings: {
          left: settingsRect.left,
          top: settingsRect.top,
          right: settingsRect.right,
          bottom: settingsRect.bottom,
        },
        panelOverflowX: panel.scrollWidth > panel.clientWidth + 1,
      };
    });

    expect(metrics.settings.left).toBeGreaterThanOrEqual(metrics.panel.left);
    expect(metrics.settings.right).toBeLessThanOrEqual(metrics.panel.right);
    expect(metrics.settings.top).toBeGreaterThanOrEqual(metrics.panel.top);
    expect(metrics.settings.bottom).toBeLessThanOrEqual(metrics.panel.bottom);
    expect(metrics.panelOverflowX).toBe(false);
  } finally {
    await srv.stop();
  }
});

for (const viewport of COMPACT_READY_VIEWPORTS) {
  test(`debug-ui: compact ready chat stays usable inside the ${viewport.name} overlay`, async ({ page }) => {
    const srv = await startViteDevServer({
      name: 'vgplot-gallery',
      cwd: exampleDir('vgplot-gallery'),
    });

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        localStorage.removeItem('vacp:debug:size');
        localStorage.removeItem('vacp:debug:dock');
      });
      await seedDebugChatThreadOnNextLoad(page, {
        runtimeId: viewport.runtimeId,
        threadId: `${COMPACT_READY_THREAD_ID}:${viewport.name}`,
        question: COMPACT_READY_QUESTION,
        answer: COMPACT_READY_ANSWER,
        label: 'wnba-shots',
        sessionKey: 'vgplot/wnba-shots',
        viewRef: 'vacp://vacp-examples/vgplot/wnba-shots',
        vizRef: 'vacp://vacp-examples/vgplot/wnba-shots/plot-0',
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
      expect(layout.input.left).toBeGreaterThanOrEqual(layout.panel.left);
      expect(layout.input.right).toBeLessThanOrEqual(layout.panel.right);
      expect(layout.input.bottom).toBeLessThanOrEqual(layout.panel.bottom);
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
