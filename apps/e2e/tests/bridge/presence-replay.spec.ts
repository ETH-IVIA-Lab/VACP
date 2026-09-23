import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';

test.use({
  exampleOptions: { paceAgentSteps: true },
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});
const bodyRef = 'vacp://vacp-examples/athletes/physique/param/body';
/** The cohort filters as the shared state reports them. */
async function filters(page: Page) {
  return page.evaluate(async () => {
    const cohort = (await window.__vacp!.getState()).state['vacp://vacp-examples/athletes/cohort'] as {
      age?: unknown;
      body?: unknown;
    };
    return { age: cohort.age ?? null, body: !!cohort.body };
  });
}
async function tool(page: Page, suffix: string, params: unknown = {}) {
  return page.evaluate(
    async ({ suffix, params }) => {
      const context = document.modelContext!;
      const action = (await context.getTools()).find((tool) => tool.name.endsWith(suffix))!;
      return JSON.parse(await context.executeTool(action, JSON.stringify(params)));
    },
    { suffix, params },
  );
}

test('hover-only replay restores all three athlete sources and yields to new human work', async ({
  page,
}, testInfo) => {
  const server = appServer('athlete-explorer');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => !!window.__vacp?.beginAgentActivity);
  await expect(page.locator('[data-vacp-bubble]')).toHaveCount(0);
  const sex = page.getByRole('combobox', { name: 'Sex' });
  await sex.selectOption('female');
  await expect(sex).toHaveValue('female');
  await expect(page.locator('[data-vacp-bubble]')).toHaveCount(0);
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('5,205');
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.__vacp!.getProvenance!()).records.filter(
            (entry) => entry.kind === 'observation' && entry.actor.kind === 'human',
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(
    () =>
      (window.__vacpStream = window.__vacp!.beginAgentActivity({
        actor: { id: 'webmcp', label: 'Analyst', kind: 'agent' },
        summary: 'Comparing rowers and canoeists',
      })),
  );
  expect((await tool(page, 'cohort.set_sports', { sports: ['canoe', 'rowing'] })).ok).toBe(true);
  const sportsCount = await page.locator('.athlete-summary strong').first().textContent();
  expect(
    (await tool(page, 'vega_lite.set_selection', { ref: bodyRef, value: { x: [65.5, 90.5], y: [1.705, 1.955] } })).ok,
  ).toBe(true);
  const bodyCount = await page.locator('.athlete-summary strong').first().textContent();
  expect((await tool(page, 'vgplot.set_interval_1d', { plotId: 'age', interactorId: '0', min: 22, max: 28 })).ok).toBe(
    true,
  );
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('117');
  const ageEntry = await page.evaluate(async () =>
    (await window.__vacp!.getProvenance!()).records
      .slice()
      .reverse()
      .find((entry) => entry.kind === 'action' && entry.execution.name.endsWith('vgplot.set_interval_1d')),
  );
  expect(
    ageEntry?.kind === 'action' && ageEntry.observation?.state['vacp://vacp-examples/athletes/cohort'],
  ).toMatchObject({
    count: 117,
    age: [22, 28],
  });
  await page.evaluate(() => window.__vacpStream!.end({ summary: 'The comparison is ready.' }));
  const back = page.getByRole('button', { name: 'Previous analytical step' });
  const next = page.getByRole('button', { name: 'Next analytical step' });
  const close = page.getByRole('button', { name: 'Return to live analysis' });
  const bubble = page.locator('[data-vacp-bubble]');
  await expect(bubble).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect.poll(() => page.locator('.vacp-stepper').evaluate((nav) => getComputedStyle(nav).opacity)).toBe('0');
  await bubble.hover();
  await expect.poll(() => page.locator('.vacp-stepper').evaluate((nav) => getComputedStyle(nav).opacity)).toBe('1');
  await back.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.athlete-summary strong').first()).toHaveText(bodyCount!);
  await expect.poll(async () => (await filters(page)).age).toBeNull();
  await back.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.athlete-summary strong').first()).toHaveText(sportsCount!);
  await expect.poll(async () => (await filters(page)).body).toBe(false);
  await expect(back).toBeDisabled();
  await expect(bubble).toContainText(/Step \d+ of \d+/);
  await expect(bubble.locator('.vacp-agent-mark svg')).toBeVisible();
  await next.click();
  await expect(page.locator('.athlete-summary strong').first()).toHaveText(bodyCount!);
  await close.click();
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('117');
  await expect.poll(() => filters(page)).toEqual({ age: [22, 28], body: true });
  // Returning to live analysis dismisses the whole trail until the agent starts new work.
  await expect(bubble).toHaveCount(0);
  await sex.selectOption('male');
  await expect(sex).toHaveValue('male');
  await expect(close).toBeHidden();
  // The human change applies to the live cohort the agent left behind.
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('185');
  await expect(bubble).toHaveCount(0);
  const entries = await page.evaluate(async () => (await window.__vacp!.getProvenance!()).records);
  expect(
    entries
      .filter((entry) => entry.kind === 'action' && entry.execution.restoration)
      .every((entry) => entry.kind === 'action' && entry.execution.actor.kind === 'human'),
  ).toBe(true);
  expect(entries.at(-1)).toMatchObject({ kind: 'observation', actor: { kind: 'human' } });
  await page.screenshot({ path: testInfo.outputPath('replay.png'), fullPage: true });
  expect(errors).toEqual([]);
});
