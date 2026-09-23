import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';
import { settled, tool } from '../helpers/presence';

test.use({
  exampleOptions: { paceAgentSteps: true },
  viewport: { width: 1440, height: 1000 },
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});
const bodyRef = 'vacp://vacp-examples/athletes/physique/param/body';

test('the step bubble follows the agent cursor through replay, and dismissal removes the whole trail', async ({
  page,
}, testInfo) => {
  const server = appServer('athlete-explorer');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => !!window.__vacp?.beginAgentActivity);
  await page.evaluate(
    () =>
      (window.__vacpStream = window.__vacp!.beginAgentActivity({
        actor: { id: 'webmcp', label: 'Analyst', kind: 'agent' },
        summary: 'Comparing rowers and canoeists',
      })),
  );
  // Each step is narrated as it happens; replay must show the same sentence for the same step.
  const narration = {
    sports: 'Keeping canoeists and rowers so the two paddle sports can be compared.',
    body: 'Selecting the taller, heavier body range typical of elite rowers.',
    age: 'Narrowing to ages 22 to 28, when most medals are won.',
  };
  expect((await tool(page, 'cohort.set_sports', { sports: ['canoe', 'rowing'] })).ok).toBe(true);
  await page.evaluate((text) => window.__vacpStream!.update(text), narration.body);
  expect(
    (await tool(page, 'vega_lite.set_selection', { ref: bodyRef, value: { x: [65.5, 90.5], y: [1.705, 1.955] } })).ok,
  ).toBe(true);
  await page.evaluate((text) => window.__vacpStream!.update(text), narration.age);
  expect((await tool(page, 'vgplot.set_interval_1d', { plotId: 'age', interactorId: '0', min: 22, max: 28 })).ok).toBe(
    true,
  );
  await page.evaluate(() => window.__vacpStream!.end({ summary: 'The comparison is ready.' }));

  const bubble = page.locator('[data-vacp-bubble]');
  const back = page.getByRole('button', { name: 'Previous analytical step' });
  const next = page.getByRole('button', { name: 'Next analytical step' });
  await expect(bubble).toHaveCount(1);
  await bubble.hover();

  // Each recorded step places its bubble beside the cursor that performed it, clear of the step's outline.
  const steps: Awaited<ReturnType<typeof settled>>[] = [];
  const evidence = async (name: string) => {
    const step = await settled(page);
    expect(step.distance, `${name}: bubble beside the cursor`).toBeLessThanOrEqual(48);
    expect(step.covered, `${name}: bubble clear of the step outline`).toBe(0);
    if (name !== '01-latest-age-brush') await expect(bubble).toContainText(/Step \d+ of \d+/);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    steps.push(step);
  };
  const summary = bubble.locator('[data-vacp-summary]');
  await evidence('01-latest-age-brush');
  await back.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toContainText(narration.body);
  await evidence('02-earlier-body-brush');
  await back.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toContainText('Comparing rowers and canoeists');
  await evidence('03-earliest-sports');
  await next.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toContainText(narration.body);
  await evidence('04-forward-body-brush');
  await next.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toContainText(narration.age);
  // The bubble travelled with the cursor: distinct steps put it in distinct places, and returning restores the spot.
  expect(new Set(steps.slice(0, 3).map((step) => `${step.bubble.x},${step.bubble.y}`)).size).toBe(3);
  expect(steps[3]!.bubble).toEqual(steps[1]!.bubble);

  // Leaving review dismisses the trail completely: no bubble, cursor, outline, or reappearance on layout or human input.
  await page.getByRole('button', { name: 'Return to live analysis' }).click();
  const shadow = page.locator('[data-vacp-presence]');
  const gone = async () =>
    shadow.evaluate((host) => {
      const root = host.shadowRoot!;
      return {
        bubbles: root.querySelectorAll('[data-vacp-bubble]').length,
        pointers: root.querySelectorAll('g[data-vacp-phase]').length,
        outlines: [...root.querySelectorAll('path[data-precision]')].filter((cue) => cue.getAttribute('d')).length,
      };
    });
  await expect.poll(gone).toEqual({ bubbles: 0, pointers: 0, outlines: 0 });
  await page.screenshot({ path: testInfo.outputPath('05-dismissed.png') });
  await page.evaluate(() => scrollTo(0, 200));
  await page.getByRole('combobox', { name: 'Sex' }).selectOption('female');
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
  expect(await gone()).toEqual({ bubbles: 0, pointers: 0, outlines: 0 });

  // New agent work brings presence back; the retained step offers the same full dismissal.
  await page.evaluate(() => {
    const turn = window.__vacp!.beginAgentActivity({ actor: { id: 'webmcp', label: 'Analyst', kind: 'agent' } });
    window.__vacpStream = turn;
  });
  await expect(bubble).toHaveCount(1);
  expect((await tool(page, 'cohort.set_sex', { sex: 'male' })).ok).toBe(true);
  await page.evaluate(() => window.__vacpStream!.end({ summary: 'Switched to male athletes.' }));
  await bubble.hover();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect.poll(gone).toEqual({ bubbles: 0, pointers: 0, outlines: 0 });
  await page.evaluate(() => {
    delete window.__vacpStream;
  });
  expect(errors).toEqual([]);
});
