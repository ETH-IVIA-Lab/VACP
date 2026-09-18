import { expect, test } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';
import { chatScrollState, runtimeId, seedInspectorChatThreadOnNextLoad, waitForVacpBridge } from './helpers';

const artifactsDir = artifactDir('playwright-inspector-chat-scroll');

const RUNTIME_ID = '00000000-0000-4000-8000-000000000101';

const THREAD_ID = 'thread:scroll-regression';

const QUESTION = "select the team that's the most efficient among all";

const LONG_ANSWER = Array.from(
  { length: 80 },
  (_, idx) =>
    `Paragraph ${idx + 1}: compare the shot chart context, cite the observed ranking, and keep the response verbose enough to force sustained vertical overflow in the chat transcript.`,
).join('\n\n');

test('inspector: chat scroll keeps the first user turn reachable', async ({ page }) => {
  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
    artifactsDir,
  });

  try {
    await seedInspectorChatThreadOnNextLoad(page, {
      runtimeId: RUNTIME_ID,
      threadId: THREAD_ID,
      question: QUESTION,
      answer: LONG_ANSWER,
      label: 'wnba-shots',
      sessionKey: 'vgplot/wnba-shots',
      viewRef: 'vacp://vacp-examples/vgplot/wnba-shots',
      vizRef: 'vacp://vacp-examples/vgplot/wnba-shots/plot-0',
    });
    await page.goto(`${srv.url}?vacp-inspector=1&vacp-runtime-id=${RUNTIME_ID}#wnba-shots`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForVacpBridge(page, { requireRuntime: true });
    await expect.poll(async () => await runtimeId(page)).toBe(RUNTIME_ID);

    const pill = page.locator('button.vacp-inspector-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-inspector-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Chat' }).click();
    await expect(page.locator('[data-vacp-chat-input="1"]')).toBeVisible();

    await expect
      .poll(async () => await chatScrollState(page))
      .toMatchObject({
        overflow: true,
        atBottom: true,
        outerScrollMoved: false,
      });

    const scrollerBox = await page.locator('[data-vacp-chat-msgs="1"]').boundingBox();

    if (!scrollerBox) throw new Error('Missing chat scroller box');
    await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);
    await page.mouse.wheel(0, -10_000);

    await expect
      .poll(async () => await chatScrollState(page))
      .toMatchObject({
        atTop: true,
        firstUserVisible: true,
        outerScrollMoved: false,
      });

    const firstUser = page.locator('[data-vacp-chat-message-role="user"]').first();
    await expect(firstUser).toContainText(QUESTION);
    await expect(firstUser).toBeVisible();

    const jumpToLatest = page.getByRole('button', { name: 'Jump to latest' });
    await expect(jumpToLatest).toBeVisible();

    await page.waitForTimeout(120);
    await expect
      .poll(async () => await chatScrollState(page))
      .toMatchObject({
        atTop: true,
        outerScrollMoved: false,
      });

    await jumpToLatest.click();
    await expect
      .poll(async () => await chatScrollState(page))
      .toMatchObject({
        overflow: true,
        atBottom: true,
        outerScrollMoved: false,
      });
    await expect(jumpToLatest).toBeHidden();
  } finally {
    await srv.stop();
  }
});
