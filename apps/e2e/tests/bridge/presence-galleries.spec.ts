import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';
import { appReady, appServer } from '../helpers/servers';

test.use({
  exampleOptions: { paceAgentSteps: true },
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

/** Invoke a registered WebMCP tool the way a browser agent would, timing the call from the agent's side. */
async function call(page: Page, suffix: string, params: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ suffix, params }) => {
      const context = document.modelContext!;
      const tool = (await context.getTools()).find((tool) => tool.name.endsWith(suffix));
      if (!tool) throw new Error(`Missing tool: ${suffix}`);
      // Chrome reports each registered schema as JSON text.
      const schema = typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema;
      const required: string[] = schema?.required ?? [];
      const input = required.includes('narration') ? { narration: 'Adjusting the view.', ...params } : params;
      const started = performance.now();
      const result = JSON.parse(await context.executeTool(tool, JSON.stringify(input)));
      return { result, elapsed: performance.now() - started };
    },
    { suffix, params },
  );
}

async function selectionRef(page: Page, title: string) {
  const { result } = await call(page, 'vacp.observe');
  const node = result.graph.nodes.find(
    (node: { kind: string; title?: string }) => node.kind === 'Selection' && node.title === title,
  );
  if (!node) throw new Error(`Missing selection ${title}`);
  return node.ref as string;
}

const scenarios = [
  {
    route: 'athletes/',
    subject: 'Olympic athlete cohort',
    narration: 'Looking at how the cohort splits by sex',
    action: 'cohort.set_sex',
    params: async () => ({ sex: 'female' }),
    closing: 'Female athletes are now in view.',
  },
  {
    route: 'vgplot/#weather',
    subject: 'Seattle Weather',
    narration: 'Keeping only the summer days',
    action: 'vgplot.set_interval_1d',
    params: async () => ({ plotId: 'plot-0', interactorId: '0', min: 1338508800000, max: 1346457600000 }),
    closing: 'Summer days are selected.',
  },
  {
    route: 'vega-lite/#seattle-weather',
    subject: 'Seattle Weather',
    narration: 'Picking out the rainy days',
    action: 'vega_lite.set_selection',
    params: async (page: Page) => ({ ref: await selectionRef(page, 'click'), value: { weather: 'rain' } }),
    closing: 'Rainy days are highlighted.',
  },
  {
    route: 'react-dashboard/',
    subject: 'Iris and Motor Trend explorer',
    narration: 'Loading the iris measurements',
    action: 'dashboard.set_dataset',
    params: async () => ({ id: 'iris' }),
    closing: 'The iris dataset is loaded.',
  },
  {
    route: 'cars-parcoords/',
    subject: 'Cars parallel coordinates',
    narration: 'Keeping cars with 100 to 200 horsepower',
    action: 'parallel_coords.set_brush_ranges',
    params: async () => ({ ranges: { Horsepower: [100, 200] } }),
    closing: 'Mid-range horsepower cars remain.',
  },
] as const;

for (const scenario of scenarios) {
  test(`${scenario.route} shows a narrated, paced agent step through the shared presence integration`, async ({
    page,
  }, testInfo) => {
    const server = appServer('gallery');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL(scenario.route, server.url).href);
    await expect
      .poll(
        async () =>
          page.evaluate(
            async (suffix) =>
              ((await document.modelContext?.getTools()) ?? []).some((tool) => tool.name.endsWith(suffix)),
            scenario.action,
          ),
        appReady,
      )
      .toBe(true);
    await expect(page.locator('[data-vacp-bubble]')).toHaveCount(0);

    // The agent speaks first; its sentence streams into the bubble before anything moves.
    await call(page, 'vacp.progress', { message: scenario.narration });
    const bubble = page.locator('[data-vacp-bubble]');
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('[data-vacp-summary]')).toContainText(scenario.narration);
    // While the agent works, the loading blocks replace the bot mark; the heading names the view, never the phase.
    await expect(bubble.locator('[data-vacp-mark][data-busy]')).toHaveCount(1);
    expect(
      await bubble.locator('[data-vacp-gather]').evaluate((node) => node.getAnimations({ subtree: true }).length),
    ).toBeGreaterThan(0);

    // The paced action travels to its target, rests there, applies, and holds before returning.
    const { result, elapsed } = await call(page, scenario.action, {
      ...(await scenario.params(page)),
      narration: scenario.narration,
    });
    expect(result.ok).toBe(true);
    // Travel and a beat at the target come first, then the configured pause after the change.
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    await expect(page.locator('g[data-vacp-phase]')).toBeVisible();
    await expect(bubble).toContainText(scenario.narration);
    await expect(bubble.locator('[data-vacp-heading]')).toHaveText(scenario.subject);
    await page.screenshot({ path: testInfo.outputPath('narrated-step.png') });

    await call(page, 'vacp.progress', { message: scenario.closing, done: true });
    await expect(bubble.locator('[data-vacp-summary]')).toContainText(scenario.closing);
    await expect(bubble.locator('[data-vacp-mark][data-busy]')).toHaveCount(0);
    await expect(bubble.locator('[data-vacp-mark] svg')).toBeVisible();
    // The closing words belong to the request's conclusion, the live state after its last step.
    await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Conclusion');
    expect(errors).toEqual([]);
  });
}
