import { expect, type Locator, type Page } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import { settled, tool } from '../helpers/presence';
import { gotoApp } from '../helpers/servers';

test.use({ viewport: { width: 1440, height: 900 } });
useWebMcp();

/** Open the cohort page with one settled agent step on screen. */
async function stepOnScreen(page: Page) {
  await gotoApp(page, 'athlete-explorer');
  const bubble = page.locator('[data-vacp-bubble]');
  const cursor = page.locator('[data-vacp-presence] [data-vacp-cursor]');
  expect((await tool(page, 'cohort.set_sex', { sex: 'female', narration: 'Keeping only female athletes.' })).ok).toBe(
    true,
  );
  await expect(bubble.locator('[data-vacp-summary]')).toHaveText('Keeping only female athletes.');
  await expect(cursor).toBeVisible();
  await settled(page);
  return { bubble, cursor };
}

/**
 * The bubble's surface over the next frames. Its box carries every movement of the bubble and every
 * resize the surface paints.
 */
function surface(bubble: Locator, frames = 1) {
  return bubble.evaluate(async (node, frames) => {
    const boxes: { x: number; y: number; height: number }[] = [];
    for (let frame = 0; frame < frames; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { x, y, height } = node.firstElementChild!.getBoundingClientRect();
      boxes.push({ x: Math.round(x), y: Math.round(y), height: Math.round(height) });
    }
    return boxes;
  }, frames);
}

/**
 * Stretch every animation that runs on the page from now on to ten minutes, past any test timeout, until
 * the returned release restores its timing. DevTools reports an animation shortly after it starts, and the
 * longer duration puts it back near its first keyframe, so it is still under way however long the test
 * takes to look. Animation frames keep their pace, so a cursor flight lands on time.
 */
async function slowAnimations(page: Page) {
  const devtools = await page.context().newCDPSession(page);
  // Each animation's own timing, once its slower timing applies.
  const timings: Promise<{ animationId: string; duration: number; delay: number }>[] = [];
  let slowing = true;
  devtools.on('Animation.animationStarted', ({ animation: { id: animationId, source } }) => {
    if (!slowing || !source) return;
    const { duration, delay } = source;
    const slower = devtools.send('Animation.setTiming', { animationId, duration: 600_000, delay });
    timings.push(slower.then(() => ({ animationId, duration, delay })));
  });
  await devtools.send('Animation.enable');
  return async () => {
    slowing = false;
    for (const timing of await Promise.all(timings)) await devtools.send('Animation.setTiming', timing);
  };
}

/**
 * Resolves when the cursor lands on its next step. Its flight carries the bubble to a new position on
 * every frame but the first, and leaves it in place once it lands.
 */
function landing(page: Page) {
  return page.evaluate(() => {
    const shadow = document.querySelector('[data-vacp-presence]')!.shadowRoot!;
    const bubble = shadow.querySelector<HTMLElement>('[data-vacp-bubble]')!;
    const start = bubble.style.transform;
    return new Promise<void>((resolve) => {
      let position = start;
      let still = 0;
      const check = () => {
        still = bubble.style.transform === position ? still + 1 : 0;
        position = bubble.style.transform;
        if (position !== start && still === 2) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  });
}

test('a printed page leaves out the agent cursor and bubble, which return in place on screen', async ({ page }) => {
  const { bubble, cursor } = await stepOnScreen(page);
  const [before] = await surface(bubble);

  await page.emulateMedia({ media: 'print' });
  await expect(bubble).toBeHidden();
  await expect(cursor).toBeHidden();
  // A print preview stays open far longer than the bubble's 220 ms transitions.
  await page.waitForTimeout(500);

  await slowAnimations(page);
  await page.emulateMedia({ media: 'screen' });
  await expect(bubble).toBeVisible();
  await expect(cursor).toBeVisible();
  expect(await surface(bubble, 12)).toEqual(Array(12).fill(before));
});

test('a step that lands while the page prints shows the bubble already at rest on screen', async ({ page }) => {
  const { bubble } = await stepOnScreen(page);
  const release = await slowAnimations(page);

  await page.emulateMedia({ media: 'print' });
  const landed = landing(page);
  expect(
    (
      await tool(page, 'vgplot.set_interval_1d', {
        ref: 'vacp://vacp-examples/athletes/age/interactor/0',
        min: 18,
        max: 25,
        narration: 'Narrowing to ages 18 to 25.',
      })
    ).ok,
  ).toBe(true);
  await landed;

  await page.emulateMedia({ media: 'screen' });
  const frames = await surface(bubble, 12);
  await release();
  await settled(page);
  expect(frames).toEqual(Array(12).fill((await surface(bubble))[0]));
});

test('words that change while the page prints and the bubble resizes keep it in place on screen', async ({ page }) => {
  const { bubble } = await stepOnScreen(page);
  const [before] = await surface(bubble);
  // Slowed, the bubble's resize to the first words is still running when the next words arrive in print.
  await slowAnimations(page);
  // Each step keeps the same filter, so the cursor stays on its control and only the words change.
  const narrate = async (narration: string) => {
    expect((await tool(page, 'cohort.set_sex', { sex: 'female', narration })).ok).toBe(true);
    await expect(bubble.locator('[data-vacp-summary]')).toHaveText(narration);
  };

  await narrate('Keeping only female athletes, so the age chart compares women across every sport.');
  await expect.poll(async () => (await surface(bubble))[0]!.height).toBeGreaterThan(before!.height);
  await page.emulateMedia({ media: 'print' });
  await narrate(
    'Keeping only female athletes, so the age chart compares women across every sport, every games, and every medal since the first modern Olympics.',
  );

  await page.emulateMedia({ media: 'screen' });
  const frames = await surface(bubble, 12);
  for (const frame of frames) expect(frame).toMatchObject({ x: before!.x, y: before!.y });
  expect(Math.min(...frames.map((frame) => frame.height))).toBeGreaterThanOrEqual(before!.height);
});
