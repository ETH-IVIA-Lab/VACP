import { expect, test, type Page } from '@playwright/test';
import { startAppServer } from '../helpers/devserver';
import { exampleDir, repoRoot } from '../helpers/paths';

async function cursorWithinVisualization(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)?.getBoundingClientRect();
    const host = document.querySelector('[data-vacp-presence]');
    const pointer = host?.shadowRoot?.querySelector('svg g')?.getBoundingClientRect();
    return (
      !!root &&
      !!pointer &&
      pointer.x >= root.left &&
      pointer.x <= root.right &&
      pointer.y >= root.top &&
      pointer.y <= root.bottom
    );
  }, selector);
}

test('custom SDK actions produce passive presence through native WebMCP without a global bridge', async ({
  browser,
}) => {
  const server = await startAppServer({ name: 'presence-custom', cwd: exampleDir('cars-parallel-coords') });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      globalThis.__vacpExampleOptions = { exposeBridge: false };
    });
    await page.goto(server.url);
    // Use the same native API exercised by the WebMCP transport suite.
    await expect
      .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.length ?? 0))
      .toBeGreaterThan(2);
    const result = await page.evaluate(async () => {
      const context = document.modelContext!;
      const tools = await context.getTools();
      const tool = tools.find((tool) => tool.name === 'vacp.action.parallel_coords.set_brush_ranges')!;
      let inputEvents = 0;
      const onInput = () => inputEvents++;
      document.addEventListener('pointerdown', onInput);
      try {
        const result = JSON.parse(
          await context.executeTool(tool, JSON.stringify({ ranges: { Horsepower: [100, 150] } })),
        );
        return { result, inputEvents, exposed: '__vacp' in globalThis };
      } finally {
        document.removeEventListener('pointerdown', onInput);
      }
    });
    expect(result.result.ok).toBe(true);
    expect(result.exposed).toBe(false);
    expect(result.inputEvents).toBe(0);
    await expect.poll(() => cursorWithinVisualization(page, '#chart')).toBe(true);
    await expect(page.locator('[data-vacp-presence] [role=status]')).toContainText('applied');
    expect(
      await page.locator('[data-vacp-presence]').evaluate((element) => getComputedStyle(element).pointerEvents),
    ).toBe('none');
  } finally {
    await context.close();
    await server.stop();
  }
});

test('VGPlot presence matches the native interval brush', async ({ page }) => {
  const server = await startAppServer({ name: 'presence-vgplot', cwd: exampleDir('vgplot-gallery') });
  try {
    await page.goto(`${server.url}#weather`);
    await page.waitForFunction(() => !!globalThis.__vacp);
    const result = await page.evaluate(async () => {
      const bridge = globalThis.__vacp;
      const action = (await bridge.getCapabilities()).graph.actions.find(
        (action) => action.operation.contract === 'vgplot.set_interval_1d',
      )!;
      return bridge.execute({
        callId: 'presence',
        name: action.name,
        params: {
          plotId: 'plot-0',
          interactorId: '0',
          min: Date.UTC(2012, 5, 1),
          max: Date.UTC(2012, 8, 1),
        },
      });
    });
    expect(result.ok).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const brush = document.querySelector('#app svg rect.selection')?.getBoundingClientRect();
          const cue = document
            .querySelector('[data-vacp-presence]')
            ?.shadowRoot?.querySelector('svg > path')
            ?.getBoundingClientRect();
          if (!brush || !cue || brush.width <= 0) return null;
          return {
            x: cue.x - brush.x,
            y: cue.y - brush.y,
            width: cue.width - brush.width,
            height: cue.height - brush.height,
          };
        }),
      )
      .toEqual({
        x: expect.closeTo(0, 0),
        y: expect.closeTo(0, 0),
        width: expect.closeTo(0, 0),
        height: expect.closeTo(0, 0),
      });
  } finally {
    await server.stop();
  }
});

test('Vega presence matches the native brush with padding, scaling, and high pixel density', async ({ browser }) => {
  const server = await startAppServer({ name: 'presence-projection', cwd: exampleDir('vega-lite-gallery') });
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await page.goto(server.url);
    const measurements = await page.evaluate(async (rootPath) => {
      const { mountPresenceChart }: typeof import('../../fixtures/presence') = await import(
        `/@fs${rootPath}/apps/e2e/fixtures/presence.ts`
      );
      const root = document.createElement('div');
      root.style.cssText =
        'position:fixed;left:80px;top:100px;transform:scale(.8);transform-origin:top left;background:white';
      document.body.append(root);
      const measure = async (renderer: 'svg' | 'canvas') => {
        const chart = await mountPresenceChart(root, renderer);
        try {
          await chart.filter();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const overlay = [...document.querySelectorAll('[data-vacp-presence]')].at(-1)!;
          const cue = overlay.shadowRoot!.querySelector('svg > path')!.getBoundingClientRect();
          const brush = root.querySelector('.brush_brush_bg path')?.getBoundingClientRect();
          return {
            cue: { x: cue.x, y: cue.y, width: cue.width, height: cue.height },
            brush: brush ? { x: brush.x, y: brush.y, width: brush.width, height: brush.height } : null,
          };
        } finally {
          chart.dispose();
          root.replaceChildren();
        }
      };
      try {
        return { svg: await measure('svg'), canvas: await measure('canvas') };
      } finally {
        root.remove();
      }
    }, repoRoot);
    expect(measurements.svg.brush).not.toBeNull();
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(measurements.svg.cue[key]).toBeCloseTo(measurements.svg.brush![key], 0);
      expect(measurements.canvas.cue[key]).toBeCloseTo(measurements.svg.cue[key], 0);
    }
  } finally {
    await context.close();
    await server.stop();
  }
});

test('cursor activation presses once, emits a blue ripple, and respects reduced motion', async ({ page }) => {
  const server = await startAppServer({ name: 'presence-feedback', cwd: exampleDir('vega-lite-gallery') });
  try {
    await page.goto(server.url);
    const samples = await page.evaluate(async (rootPath) => {
      const { mountPresenceChart }: typeof import('../../fixtures/presence') = await import(
        `/@fs${rootPath}/apps/e2e/fixtures/presence.ts`
      );
      const root = document.createElement('div');
      root.style.cssText = 'position:fixed;left:80px;top:100px;background:white';
      document.body.append(root);
      const measure = async (motion: 'full' | 'reduced') => {
        const chart = await mountPresenceChart(root, 'svg', { appearance: { motion } });
        try {
          await chart.filter();
          const overlay = [...document.querySelectorAll('[data-vacp-presence]')].at(-1)!.shadowRoot!;
          const glyph = overlay.querySelector<SVGGElement>('[data-vacp-cursor]')!;
          const ripple = overlay.querySelector<SVGCircleElement>('[data-vacp-ripple]')!;
          const press = glyph.getAnimations()[0];
          const expansion = ripple.getAnimations()[0];
          if (press) {
            press.pause();
            press.currentTime = 100;
          }
          if (expansion) {
            expansion.pause();
            expansion.currentTime = 200;
          }
          const before = glyph.getAnimations().length;
          root.style.paddingLeft = '1px';
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return {
            motion,
            shape: glyph.querySelector('path')!.getAttribute('d'),
            transform: getComputedStyle(glyph).transform,
            rippleColor: ripple.getAttribute('stroke'),
            rippleOpacity: Number(getComputedStyle(ripple).opacity),
            expanding: !!expansion,
            before,
            after: glyph.getAnimations().length,
          };
        } finally {
          chart.dispose();
          root.replaceChildren();
          root.style.paddingLeft = '';
        }
      };
      try {
        return [await measure('full'), await measure('reduced')];
      } finally {
        root.remove();
      }
    }, repoRoot);
    expect(samples[0]!.shape).toBe('M0 0L14 8.5L7.5 10L4 16Z');
    expect(samples[0]!.transform).toContain('0.8');
    expect(samples[0]!.rippleColor).toBe('#60a5fa');
    expect(samples[0]!.rippleOpacity).toBeCloseTo(0.4, 1);
    expect(samples[0]!.after).toBe(samples[0]!.before);
    expect(samples[1]!.transform).toBe('none');
    expect(samples[1]!.expanding).toBe(false);
  } finally {
    await server.stop();
  }
});

test.use({
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});
