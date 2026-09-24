import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';
import { appReady, appServer } from '../helpers/servers';
import { tool } from '../helpers/presence';

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(appServer('athlete-explorer').url);
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          ((await document.modelContext?.getTools()) ?? []).some((tool) =>
            tool.name.endsWith('vgplot.set_interval_1d'),
          ),
        ),
      appReady,
    )
    .toBe(true);
  return errors;
}

/** The recorded sentence of every agent step, oldest first. */
async function recorded(page: Page) {
  return page.evaluate(() =>
    window
      .__vacp!.getProvenance()
      .records.filter((record) => record.kind === 'action' && record.execution.actor.kind === 'agent')
      .map((record) => (record.kind === 'action' ? (record.execution.narration ?? null) : null)),
  );
}

/**
 * Walk the whole request trail from its conclusion back to its start and forward again, reading the
 * words each frame shows by the name the heading gives it.
 */
async function replayed(page: Page) {
  const bubble = page.locator('[data-vacp-bubble]');
  const label = bubble.locator('[data-vacp-heading]');
  const summary = bubble.locator('[data-vacp-summary], [data-vacp-waiting]').filter({ visible: true });
  const read = async () => {
    await expect(bubble).toHaveAttribute('aria-busy', 'false');
    // Replayed words are revealed again, a word at a time.
    await expect(bubble.locator('[data-streaming]')).toHaveCount(0);
    return [await label.innerText(), (await summary.innerText()).replace(/\s+/g, ' ').trim()] as const;
  };
  await bubble.hover();
  await expect(label).toHaveText('Conclusion');
  const frames = new Map<string, string>([await read()]);
  const back = page.getByRole('button', { name: 'Previous analytical step' });
  while (await back.isEnabled()) {
    const before = await label.innerText();
    await back.click();
    await expect(label).not.toHaveText(before);
    frames.set(...(await read()));
  }
  // Stepping forward again shows each frame with the same words.
  const next = page.getByRole('button', { name: 'Next analytical step' });
  while (await next.isEnabled()) {
    const before = await label.innerText();
    await next.click();
    await expect(label).not.toHaveText(before);
    const [name, words] = await read();
    expect(words, `${name} reads the same both ways`).toBe(frames.get(name));
  }
  await expect(label).toHaveText('Conclusion');
  return Object.fromEntries(frames);
}

// The trace that motivated this: one opening sentence, then three actions, then a closing sentence.
const steps = [
  { contract: 'cohort.set_sex', params: { sex: 'female' }, narration: 'Keeping only female athletes.' },
  {
    contract: 'cohort.set_sports',
    params: { sports: ['aquatics', 'gymnastics'] },
    narration: 'Comparing swimmers and divers with gymnasts, two sports with young medalists.',
  },
  {
    contract: 'vgplot.set_interval_1d',
    params: { plotId: 'age', interactorId: '0', min: 18, max: 25 },
    narration: 'Narrowing to ages 18 to 25, where most of their medals are won.',
  },
];

test('every narrated step streams, records, and replays its own sentence', async ({ page }) => {
  const errors = await open(page);
  const summary = page.locator('[data-vacp-summary]');
  await tool(page, 'vacp.progress', { message: 'Filtering for young female gymnasts and aquatics athletes.' });
  for (const step of steps) {
    expect((await tool(page, step.contract, { ...step.params, narration: step.narration })).ok).toBe(true);
    // The live bubble shows this step's sentence while the step is on screen.
    await expect(summary).toHaveText(step.narration);
  }
  await tool(page, 'vacp.progress', {
    message: 'Young female gymnasts and aquatics athletes are in view.',
    done: true,
  });
  expect(await recorded(page)).toEqual(steps.map((step) => step.narration));
  expect(await replayed(page)).toEqual({
    Start: 'Filtering for young female gymnasts and aquatics athletes.',
    'Step 1 of 3': steps[0]!.narration,
    'Step 2 of 3': steps[1]!.narration,
    'Step 3 of 3': steps[2]!.narration,
    Conclusion: 'Young female gymnasts and aquatics athletes are in view.',
  });
  expect(errors).toEqual([]);
});

test('a step executed without narration names its change instead of repeating an earlier sentence', async ({
  page,
}) => {
  const errors = await open(page);
  const opening = 'Filtering for young female gymnasts and aquatics athletes.';
  await tool(page, 'vacp.progress', { message: opening });
  // A host can execute through the bridge without a sentence; the step carries the live words once.
  for (const step of steps) {
    const result = await page.evaluate(async ({ contract, params }) => {
      const { graph } = await window.__vacp!.getCapabilities();
      const name = graph.actions.find((action) => action.name.endsWith(contract))!.name;
      return window.__vacp!.execute(
        { callId: contract, name, params },
        { actor: { id: 'webmcp', kind: 'agent', label: 'Agent' } },
      );
    }, step);
    expect(result.ok).toBe(true);
  }
  await tool(page, 'vacp.progress', {
    message: 'Young female gymnasts and aquatics athletes are in view.',
    done: true,
  });
  expect(await recorded(page)).toEqual([opening, null, null]);
  const frames = await replayed(page);
  expect(Object.keys(frames)).toEqual(['Conclusion', 'Step 3 of 3', 'Step 2 of 3', 'Step 1 of 3', 'Start']);
  // The opening sentence came with the first step, so it is that step's; every frame reads differently.
  expect(frames['Step 1 of 3']).toBe(opening);
  expect(new Set(Object.values(frames)).size).toBe(5);
  expect(errors).toEqual([]);
});

test('an answer given without a step stays on screen until the person dismisses it', async ({ page }) => {
  const errors = await open(page);
  const bubble = page.locator('[data-vacp-bubble]');
  await tool(page, 'vacp.progress', { message: 'Counting the medalists in this cohort.' });
  await tool(page, 'vacp.state', {});
  await tool(page, 'vacp.progress', { message: 'This cohort has 873 medalists.', done: true });
  await expect(bubble.locator('[data-vacp-summary]')).toHaveText('This cohort has 873 medalists.');
  // Well past the time a finished turn lingers.
  await page.waitForTimeout(4000);
  await expect(bubble).toHaveCount(1);
  await expect(bubble.locator('[data-vacp-summary]')).toHaveText('This cohort has 873 medalists.');
  await bubble.hover();
  await expect(page.getByRole('button', { name: 'Previous analytical step' })).toBeHidden();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(bubble).toHaveCount(0);
  expect(errors).toEqual([]);
});
