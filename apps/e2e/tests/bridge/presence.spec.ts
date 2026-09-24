import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';
import { repoRoot } from '../helpers/paths';
import { appServer } from '../helpers/servers';

// WebMCP flags are worker options and apply to every test in this file.
test.use({
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

async function cursorWithinVisualization(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)?.getBoundingClientRect();
    const host = document.querySelector('[data-vacp-presence]');
    const matrix = host?.shadowRoot?.querySelector<SVGGElement>('g[data-vacp-phase]')?.getScreenCTM();
    const pointer = matrix ? new DOMPoint(0, 0).matrixTransform(matrix) : null;
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
  const server = appServer('cars-parallel-coords');
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      globalThis.__vacpExampleOptions = { ...globalThis.__vacpExampleOptions, exposeBridge: false };
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
          await context.executeTool(
            tool,
            JSON.stringify({
              ranges: { Horsepower: [100, 150] },
              narration: 'Keeping cars between 100 and 150 horsepower.',
            }),
          ),
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
    // The step shows its own sentence while the agent's request stays open for its next step.
    await expect(page.locator('[data-vacp-presence] [data-vacp-summary]')).toHaveText(
      'Keeping cars between 100 and 150 horsepower.',
    );
    // The overlay never takes input: the application still owns the point under the cursor.
    expect(
      await page.evaluate(() => {
        const pointer = document
          .querySelector('[data-vacp-presence]')!
          .shadowRoot!.querySelector<SVGGElement>('g[data-vacp-phase]')!;
        const { e, f } = pointer.getScreenCTM()!;
        return !!document.elementFromPoint(e, f)?.closest('#chart');
      }),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test('VGPlot presence matches the native interval brush', async ({ page }) => {
  const server = appServer('vgplot-gallery');
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
  await page.evaluate(() =>
    globalThis.__vacp.narrate({ actor: { id: 'agent', kind: 'agent' }, message: 'Summer is selected.', done: true }),
  );
  // The recorded step outlines the brush the request left behind.
  const bubble = page.locator('[data-vacp-bubble]');
  await bubble.hover();
  await page.getByRole('button', { name: 'Previous analytical step' }).click();
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Step 1 of 1');
  await expect(page.locator('[data-vacp-presence] [data-vacp-cursor]')).toHaveAttribute(
    'data-vacp-cursor-shape',
    'crosshair',
  );
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
});

test('Vega presence matches the native brush with padding, scaling, and high pixel density', async ({ browser }) => {
  const server = appServer('vega-lite-gallery');
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
          const overlay = [...document.querySelectorAll('[data-vacp-presence]')].at(-1)!;
          // The outline appears once the step's target resolves, which can take several frames under load.
          let outline = overlay.shadowRoot!.querySelector('path[data-precision]');
          while (!outline?.getAttribute('d')) {
            await new Promise(requestAnimationFrame);
            outline = overlay.shadowRoot!.querySelector('path[data-precision]');
          }
          const cue = outline.getBoundingClientRect();
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
  }
});

test('cursor activation presses once, ripples in the configured color, and respects reduced motion', async ({
  page,
}) => {
  const server = appServer('vega-lite-gallery');
  await page.goto(server.url);
  const samples = await page.evaluate(async (rootPath) => {
    const { mountPresenceChart }: typeof import('../../fixtures/presence') = await import(
      `/@fs${rootPath}/apps/e2e/fixtures/presence.ts`
    );
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;left:80px;top:100px;background:white';
    document.body.append(root);
    const measure = async (motion: 'full' | 'reduced') => {
      const chart = await mountPresenceChart(root, 'svg', {
        appearance: { motion, durationMs: 0, ripple: { color: '#ff0000' } },
      });
      try {
        await chart.filter();
        const overlay = [...document.querySelectorAll('[data-vacp-presence]')].at(-1)!.shadowRoot!;
        const glyph = overlay.querySelector<SVGGElement>('[data-vacp-cursor]')!;
        await new Promise<void>((resolve, reject) => {
          const started = performance.now();
          const check = () => {
            if (overlay.querySelector('[data-vacp-ripple]')) resolve();
            else if (performance.now() - started > 1500) reject(new Error('Missing activation at the resolved target'));
            else requestAnimationFrame(check);
          };
          check();
        });
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
        root.style.paddingLeft = '1px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          motion,
          shape: glyph.dataset.vacpCursorShape,
          transform: getComputedStyle(glyph).transform,
          pressScale: new DOMMatrixReadOnly(getComputedStyle(glyph).transform).a,
          rippleColor: ripple.getAttribute('stroke'),
          rippleOpacity: Number(getComputedStyle(ripple).opacity),
          expanding: !!expansion,
          retained:
            glyph.getAnimations()[0] === press &&
            ripple.getAnimations()[0] === expansion &&
            overlay.querySelector('[data-vacp-ripple]') === ripple,
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
  expect(samples[0]!.shape).toBe('crosshair');
  expect(samples[0]!.pressScale).toBeLessThan(1);
  expect(samples[0]!.rippleColor).toBe('#ff0000');
  expect(samples[0]!.rippleOpacity).toBeGreaterThan(0);
  expect(samples[0]!.rippleOpacity).toBeLessThan(1);
  expect(samples[0]!.retained).toBe(true);
  expect(samples[1]!.transform).toBe('none');
  expect(samples[1]!.expanding).toBe(false);
});

test('cursor motion preserves hotspots through interruption, invisibility and reduced motion', async ({ page }) => {
  const server = appServer('vega-lite-gallery');
  await page.goto(server.url);
  const result = await page.evaluate(async (root) => {
    const { measureCursorMotion }: typeof import('../../fixtures/presence') = await import(
      `/@fs${root}/apps/e2e/fixtures/presence.ts`
    );
    return measureCursorMotion();
  }, repoRoot);
  expect(result.middle.shape).toBe('crosshair');
  expect(result.middle.scale).toBeGreaterThan(1);
  expect(result.interruption.scale).toBe(result.middle.scale);
  expect(result.settled.scale).toBe(1);
  expect(result.hotspot.x).toBeCloseTo(400);
  expect(result.hotspot.y).toBeCloseTo(100);
  expect(result.still.scale).toBe(1);
  expect(result.recovered.x).toBeCloseTo(900);
  expect(result.recovered.y).toBeCloseTo(100);
  expect(result.afterRead.x).toBeCloseTo(600);
  expect(result.afterRead.y).toBeCloseTo(100);
});

test('cursor policy controls semantic assets and feedback, validates configuration and releases its overlay', async ({
  page,
}) => {
  const server = appServer('vega-lite-gallery');
  await page.goto(server.url);
  const result = await page.evaluate(async (root) => {
    const { measureCursorAppearance }: typeof import('../../fixtures/presence') = await import(
      `/@fs${root}/apps/e2e/fixtures/presence.ts`
    );
    return measureCursorAppearance();
  }, repoRoot);
  expect(result.initial).toMatchObject({ shape: 'arrow' });
  expect(result.pressed).toMatchObject({ shape: 'grabbing', ripple: true });
  expect(result.hover).toMatchObject({ shape: 'pointer', ripple: false });
  expect(result.overridden).toMatchObject({ shape: 'app-target', scale: 1, path: 'M0 0h24v24H0Z' });
  expect(result.feedback.ripple).toBe(false);
  expect(result.fallback).toMatchObject({ shape: 'arrow', path: 'M0 0h10v10H0Z' });
  expect(result.invalidAssetsRejected).toBe(true);
  expect(result.remaining).toBe(0);
});

test('bubbles avoid target regions throughout transitions and do not replay narration', async ({ page }) => {
  const server = appServer('vega-lite-gallery');
  await page.goto(server.url);
  const result = await page.evaluate(async (root) => {
    const { measureBubblePlacement }: typeof import('../../fixtures/presence') = await import(
      `/@fs${root}/apps/e2e/fixtures/presence.ts`
    );
    return measureBubblePlacement();
  }, repoRoot);
  expect(result.samples.length).toBeGreaterThan(4);
  expect(result.samples.every((sample) => sample.clear && sample.withinViewport)).toBe(true);
  expect(result.changes).toEqual(['Narrowing the height range', 'Narrowing the height', 'NARROWING the height']);
  expect(result.displayed).toBe('NARROWING the height');
  expect(result.announced).toBe('Analyst: NARROWING the height');
});
