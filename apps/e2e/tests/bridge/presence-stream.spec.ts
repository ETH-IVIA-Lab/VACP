import { expect } from '@playwright/test';
import { test } from '../helpers/test';

// Presence follows agent steps at the pace people see them.
test.use({ exampleOptions: { paceAgentSteps: true } });
import { appServer } from '../helpers/servers';

test('public progress waits visibly, then streams incremental Markdown without remounting old words and accepts corrections', async ({
  page,
}) => {
  const server = appServer('athlete-explorer');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(() => !!window.__vacp?.beginAgentActivity);
  await page.evaluate(() => {
    window.__vacpStream = window.__vacp!.beginAgentActivity({
      actor: { id: 'writer', kind: 'agent', label: 'Analyst' },
    });
  });
  const summary = page.locator('[data-vacp-summary]');
  const waiting = page.locator('[data-vacp-bubble] [data-vacp-waiting]');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText('Looking at the view');
  // Working state: the gathering blocks replace the bot mark and animate; reduced motion stills them.
  const mark = page.locator('[data-vacp-bubble] [data-vacp-mark]');
  await expect(mark).toHaveAttribute('data-busy', '');
  const gatherAnimations = () =>
    mark.locator('[data-vacp-gather]').evaluate((node) => node.getAnimations({ subtree: true }).length);
  expect(await gatherAnimations()).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(gatherAnimations).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(summary).toBeHidden();
  await page.evaluate(() => window.__vacpStream!.update('Comparing **row'));
  await expect(waiting).toBeHidden();
  await expect(summary.locator('strong')).toHaveText(['row']);
  const paragraph = await summary.locator('p').elementHandle();
  await page.evaluate(() =>
    window.__vacpStream!.update('Comparing **rowers** and *canoeists*.\n\nKeeping your **age range**.'),
  );
  await expect(summary.locator('strong')).toHaveText(['rowers', 'age range']);
  await expect(summary.locator('em')).toHaveText('canoeists');
  expect(await paragraph!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(summary.locator('p')).toHaveCount(2);
  expect(await summary.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);
  // A whole sentence sent at once still streams: part of it is visible first, then all of it.
  const sentence =
    'Comparing **rowers** and *canoeists*, then keeping the athletes who are between 22 and 28 years old.';
  const partial = await page.evaluate(async (text) => {
    window.__vacpStream!.update(text);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const shadow = document.querySelector('[data-vacp-presence]')!.shadowRoot!;
    return shadow.querySelector('[data-vacp-summary]')!.textContent!.trim().length;
  }, sentence);
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(sentence.replaceAll('*', '').length);
  // A thin text cursor marks the end of the text while it is still arriving, and leaves once it has landed.
  const caretWidth = () =>
    summary
      .locator('[data-vacp-prose] > div > :last-child')
      .evaluate((node) => getComputedStyle(node, '::after').width);
  expect(await caretWidth()).toBe('2px');
  await expect(summary).toContainText('between 22 and 28 years old.');
  await page.evaluate(() => window.__vacpStream!.update('Comparing **rowers**.'));
  await expect(summary.locator('p')).toHaveCount(1);
  await expect(summary.locator('strong')).toHaveText(['rowers']);
  await page.evaluate(() => window.__vacpStream!.update('Comparing **Rowers**.'));
  await expect(summary.locator('strong')).toHaveText(['Rowers']);
  await page.evaluate(() => window.__vacpStream!.update('Checking **medals** next.'));
  await expect(summary.locator('strong')).toHaveText(['medals']);
  const sameMessage = await summary.locator('p').elementHandle();
  await page.evaluate(() => window.__vacpStream!.update('Checking **medals** next.'));
  await expect(summary).toContainText('Checking medals next.');
  expect(await sameMessage!.evaluate((element) => element.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.__vacpStream!.update('Checking **medals** next. Preserving the selection.'));
  await expect(summary).toContainText('Preserving the selection.');
  expect(await summary.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const rect = await page.locator('[data-vacp-bubble]').boundingBox();
      return !!rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 390 && rect.y + rect.height <= 844;
    })
    .toBe(true);
  await page.evaluate(() => window.__vacpStream!.end({ summary: 'The **comparison** is ready.' }));
  await expect(summary.locator('strong')).toHaveText(['comparison']);
  await expect.poll(caretWidth).toBe('auto');
  expect(await summary.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  // A turn that took no step keeps its answer on screen until the person dismisses it.
  const bubble = page.locator('[data-vacp-bubble]');
  await page.waitForTimeout(2500);
  await expect(bubble).toHaveCount(1);
  await bubble.hover();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(bubble).toHaveCount(0);
  await page.evaluate(() => {
    delete window.__vacpStream;
  });
  expect(errors).toEqual([]);
});
