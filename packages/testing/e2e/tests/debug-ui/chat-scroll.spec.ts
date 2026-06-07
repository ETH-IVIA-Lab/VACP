import { expect, test, type Page } from '@playwright/test';

import { startViteDevServer } from '../helpers/devserver';
import { artifactDir, exampleDir } from '../helpers/paths';
import { runtimeId, waitForVacpBridge } from './helpers';

const artifactsDir = artifactDir('playwright-debug-ui-chat-scroll');
const SEEDED_RUNTIME_ID = '00000000-0000-4000-8000-000000000001';
const THREAD_ID = 'thread:scroll-regression';
const QUESTION = "select the team that's the most efficient among all";
const LONG_ANSWER = Array.from(
  { length: 80 },
  (_, idx) =>
    `Paragraph ${idx + 1}: compare the shot chart context, cite the observed ranking, and keep the response verbose enough to force sustained vertical overflow in the chat transcript.`,
).join('\n\n');
type UuidLike = `${string}-${string}-${string}-${string}-${string}`;
type ChatScrollState = {
  overflow: boolean;
  atTop: boolean;
  atBottom: boolean;
  firstUserVisible: boolean;
  wrapperTop: number | null;
};

async function chatScrollState(page: Page): Promise<ChatScrollState> {
  return await page.evaluate(() => {
    const scroller = document.querySelector('[data-vacp-chat-msgs="1"]') as HTMLDivElement | null;
    const wrapper = scroller?.parentElement?.parentElement as HTMLDivElement | null;
    const firstUser = document.querySelector('[data-vacp-chat-message-role="user"]') as HTMLElement | null;
    if (!scroller || !wrapper) {
      return { overflow: false, atTop: false, atBottom: false, firstUserVisible: false, wrapperTop: null };
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const scrollerRect = scroller.getBoundingClientRect();
    const firstUserRect = firstUser?.getBoundingClientRect();
    const firstUserVisible = Boolean(
      firstUserRect && firstUserRect.top >= scrollerRect.top && firstUserRect.bottom <= scrollerRect.bottom,
    );

    return {
      overflow: maxScrollTop > 0,
      atTop: Math.abs(scroller.scrollTop) <= 1,
      atBottom: maxScrollTop > 0 && Math.abs(scroller.scrollTop - maxScrollTop) <= 1,
      firstUserVisible,
      wrapperTop: wrapper.scrollTop,
    };
  });
}

test('debug-ui: chat scroll keeps the first user turn reachable', async ({ page }) => {
  await page.addInitScript(
    ({ runtimeId, threadId, question, answer }) => {
      const originalRandomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
      let randomUuidCalls = 0;

      if (globalThis.crypto && originalRandomUUID) {
        globalThis.crypto.randomUUID = () => {
          randomUuidCalls += 1;
          if (randomUuidCalls === 1) return runtimeId as UuidLike;
          return originalRandomUUID();
        };
      }

      const urlKey = `${location.origin}${location.pathname}${location.hash}`;
      const scopeId = `runtime:${runtimeId}:url:${urlKey}`;
      const createdAt = '2026-03-10T00:00:00.000Z';

      localStorage.setItem(
        'vacp:debug:chat:llmConfig:v1',
        JSON.stringify({
          version: 2,
          activeProvider: 'openai-compatible',
          providerConfigs: {
            'openai-compatible': {
              provider: 'openai-compatible',
              providerName: 'openai-compatible',
              baseURL: 'http://localhost:8317/v1',
              apiKey: 'default',
              model: 'gpt-5.4',
              temperature: 0.2,
              maxSteps: 10,
              maxOutputTokens: 900,
            },
          },
        }),
      );

      localStorage.setItem(
        'vacp:debug:chat:history:v1',
        JSON.stringify({
          state: {
            version: 1,
            activeScopeId: scopeId,
            scopes: {
              [scopeId]: {
                meta: {
                  scopeId,
                  label: 'wnba-shots',
                  runtimeId,
                  sessionKey: 'vgplot/wnba-shots',
                  viewRef: 'vacp://vacp-examples/vgplot/wnba-shots',
                  vizRef: 'vacp://vacp-examples/vgplot/wnba-shots/plot-0',
                  urlKey,
                  updatedAt: createdAt,
                },
                activeThreadId: threadId,
                threadOrder: [threadId],
                threads: {
                  [threadId]: {
                    id: threadId,
                    title: question,
                    createdAt,
                    updatedAt: createdAt,
                    sessionRevision: 0,
                    messages: [
                      {
                        id: 'message:user',
                        role: 'user',
                        parts: [{ type: 'text', text: question }],
                      },
                      {
                        id: 'message:assistant',
                        role: 'assistant',
                        parts: [{ type: 'text', text: answer }],
                      },
                    ],
                    toolEvents: [],
                  },
                },
              },
            },
            draftByThreadKey: {
              [`${scopeId}::${threadId}`]: '',
            },
            activityOpenByScope: {},
            settingsOpenByScope: {
              [scopeId]: false,
            },
          },
          version: 1,
        }),
      );
    },
    {
      runtimeId: SEEDED_RUNTIME_ID,
      threadId: THREAD_ID,
      question: QUESTION,
      answer: LONG_ANSWER,
    },
  );

  const srv = await startViteDevServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
    artifactsDir,
  });

  try {
    await page.goto(`${srv.url}?vacp-debug=1#wnba-shots`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });

    await expect.poll(async () => await runtimeId(page)).toBe(SEEDED_RUNTIME_ID);

    const pill = page.locator('button.vacp-debug-ui-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'Chat' }).click();
    await expect(page.locator('[data-vacp-chat-input="1"]')).toBeVisible();

    await expect
      .poll(async () => await chatScrollState(page))
      .toMatchObject({
        overflow: true,
        atBottom: true,
        wrapperTop: 0,
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
        wrapperTop: 0,
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
        wrapperTop: 0,
      });

    await jumpToLatest.click();
    await expect
      .poll(async () => await chatScrollState(page))
      .toMatchObject({
        overflow: true,
        atBottom: true,
        wrapperTop: 0,
      });
    await expect(jumpToLatest).toBeHidden();
  } finally {
    await srv.stop();
  }
});
