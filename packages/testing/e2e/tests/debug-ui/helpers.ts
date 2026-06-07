import type { Page } from '@playwright/test';

type DebugBridgeWaitOptions = {
  requireRuntime?: boolean;
};

type SeedDebugChatThreadOptions = {
  runtimeId: string;
  threadId: string;
  question: string;
  answer: string;
  label?: string;
  sessionKey?: string;
  viewRef?: string;
  vizRef?: string;
  model?: string;
};

export type ChatScrollState = {
  overflow: boolean;
  atTop: boolean;
  atBottom: boolean;
  firstUserVisible: boolean;
  outerScrollMoved: boolean;
};

function seedDebugChatThreadInBrowser(opts: SeedDebugChatThreadOptions): void {
  const urlKey = `${location.origin}${location.pathname}${location.hash}`;
  const scopeId = `runtime:${opts.runtimeId}:url:${urlKey}`;
  const createdAt = '2026-03-10T00:00:00.000Z';
  const label = opts.label ?? 'current view';
  const sessionKey = opts.sessionKey ?? label;
  const viewRef = opts.viewRef ?? `vacp://vacp-examples/${label}`;
  const vizRef = opts.vizRef ?? `${viewRef}/plot-0`;

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
          model: opts.model ?? 'gpt-5.4',
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
              label,
              runtimeId: opts.runtimeId,
              sessionKey,
              viewRef,
              vizRef,
              urlKey,
              updatedAt: createdAt,
            },
            activeThreadId: opts.threadId,
            threadOrder: [opts.threadId],
            threads: {
              [opts.threadId]: {
                id: opts.threadId,
                title: opts.question,
                createdAt,
                updatedAt: createdAt,
                sessionRevision: 0,
                messages: [
                  {
                    id: 'message:user',
                    role: 'user',
                    parts: [{ type: 'text', text: opts.question }],
                  },
                  {
                    id: 'message:assistant',
                    role: 'assistant',
                    parts: [{ type: 'text', text: opts.answer }],
                  },
                ],
                toolEvents: [],
              },
            },
          },
        },
        draftByThreadKey: {
          [`${scopeId}::${opts.threadId}`]: '',
        },
        activityOpenByScope: {},
        settingsOpenByScope: {
          [scopeId]: false,
        },
      },
      version: 1,
    }),
  );
}

export async function waitForVacpBridge(page: Page, options: DebugBridgeWaitOptions = {}): Promise<void> {
  await page.waitForFunction((requireRuntime) => {
    type BrowserBridge = { getRuntime?: unknown };
    const bridge = (globalThis as typeof globalThis & { __vacp?: BrowserBridge }).__vacp;
    if (!bridge) return false;
    return requireRuntime ? typeof bridge.getRuntime === 'function' : true;
  }, Boolean(options.requireRuntime));
}

export async function runtimeId(page: Page): Promise<string | null> {
  return await page.evaluate(async () => {
    type BrowserBridge = { getRuntime?: () => Promise<{ runtimeId?: string } | null> };
    const bridge = (globalThis as typeof globalThis & { __vacp?: BrowserBridge }).__vacp;
    const runtime = await bridge?.getRuntime?.();
    return runtime?.runtimeId ?? null;
  });
}

export async function seedDebugChatThreadOnNextLoad(page: Page, options: SeedDebugChatThreadOptions): Promise<void> {
  await page.addInitScript(seedDebugChatThreadInBrowser, options);
}

export async function seedDebugChatThread(page: Page, options: SeedDebugChatThreadOptions): Promise<void> {
  await page.evaluate(seedDebugChatThreadInBrowser, options);
}

export async function chatScrollState(page: Page): Promise<ChatScrollState> {
  return await page.evaluate(() => {
    const scroller = document.querySelector('[data-vacp-chat-msgs="1"]') as HTMLDivElement | null;
    const panel = document.getElementById('vacp-debug-ui-panel');
    const activePanel = panel?.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement | null;
    const firstUser = document.querySelector('[data-vacp-chat-message-role="user"]') as HTMLElement | null;
    if (!scroller || !panel || !activePanel) {
      return { overflow: false, atTop: false, atBottom: false, firstUserVisible: false, outerScrollMoved: false };
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const scrollerRect = scroller.getBoundingClientRect();
    const firstUserRect = firstUser?.getBoundingClientRect();
    const firstUserVisible = Boolean(
      firstUserRect && firstUserRect.bottom > scrollerRect.top && firstUserRect.top < scrollerRect.bottom,
    );
    const scrollableAncestors: HTMLElement[] = [];
    for (let node = scroller.parentElement; node && node !== panel; node = node.parentElement) {
      if (!activePanel.contains(node)) continue;
      if (node.scrollHeight > node.clientHeight + 1 || Math.abs(node.scrollTop) > 1) {
        scrollableAncestors.push(node);
      }
    }

    return {
      overflow: maxScrollTop > 0,
      atTop: Math.abs(scroller.scrollTop) <= 1,
      atBottom: maxScrollTop > 0 && Math.abs(scroller.scrollTop - maxScrollTop) <= 1,
      firstUserVisible,
      outerScrollMoved: scrollableAncestors.some((node) => Math.abs(node.scrollTop) > 1) || Math.abs(panel.scrollTop) > 1,
    };
  });
}

export async function dimensionOrder(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    return await readDimensionOrder();

    async function readDimensionOrder(): Promise<string[]> {
      const bridge = bridgeWithState();
      const snap = await bridge.getState();
      const param = firstParamArray(snap);
      return param.map(String);
    }

    function bridgeWithState(): { getState: () => Promise<unknown> } {
      const bridge = (globalThis as typeof globalThis & { __vacp?: { getState?: () => Promise<unknown> } }).__vacp;
      if (!bridge || typeof bridge.getState !== 'function') throw new Error('Missing bridge.getState');
      return { getState: bridge.getState.bind(bridge) };
    }

    function firstParamArray(snap: unknown): unknown[] {
      if (!snap || typeof snap !== 'object') return [];
      const state = (snap as { state?: unknown }).state;
      if (!state || typeof state !== 'object') return [];
      const param = Object.values(state as Record<string, unknown>).find(isParamArray);
      return param ? param.value : [];
    }

    function isParamArray(value: unknown): value is { kind: 'Param'; value: unknown[] } {
      return (
        Boolean(value) &&
        typeof value === 'object' &&
        (value as { kind?: unknown }).kind === 'Param' &&
        Array.isArray((value as { value?: unknown }).value)
      );
    }
  });
}

export async function dispatchDimensionOrderPair(page: Page): Promise<{ orderA: string[]; orderB: string[] }> {
  return await page.evaluate(async () => {
    const bridge = bridgeWithStateDispatch();
    const base = await readDimensionOrder(bridge);
    if (base.length < 2) throw new Error('Expected dimension order with >= 2 entries');

    const orderA = [...base];
    [orderA[0], orderA[1]] = [orderA[1]!, orderA[0]!];

    const orderB = [...orderA];
    if (orderB.length >= 3) [orderB[0], orderB[1], orderB[2]] = [orderB[2]!, orderB[0]!, orderB[1]!];

    await dispatchOrder(bridge, orderA, 'order A');
    await dispatchOrder(bridge, orderB, 'order B');
    return { orderA, orderB };

    async function readDimensionOrder(bridge: { getState: () => Promise<unknown> }): Promise<string[]> {
      const snap = await bridge.getState();
      const param = firstParamArray(snap);
      return param.map(String);
    }

    async function dispatchOrder(
      bridge: { dispatch: (call: unknown, options: unknown) => Promise<unknown> },
      order: string[],
      message: string,
    ): Promise<void> {
      await bridge.dispatch(
        { callId: crypto.randomUUID(), name: 'parallel_coords.set_dimension_order', params: { order } },
        { source: 'debug', message },
      );
    }

    function bridgeWithStateDispatch(): {
      getState: () => Promise<unknown>;
      dispatch: (call: unknown, options: unknown) => Promise<unknown>;
    } {
      const bridge = (
        globalThis as typeof globalThis & {
          __vacp?: { getState?: () => Promise<unknown>; dispatch?: (call: unknown, options: unknown) => Promise<unknown> };
        }
      ).__vacp;
      if (!bridge || typeof bridge.getState !== 'function') throw new Error('Missing bridge.getState');
      if (typeof bridge.dispatch !== 'function') throw new Error('Missing bridge.dispatch');
      return { getState: bridge.getState.bind(bridge), dispatch: bridge.dispatch.bind(bridge) };
    }

    function firstParamArray(snap: unknown): unknown[] {
      if (!snap || typeof snap !== 'object') return [];
      const state = (snap as { state?: unknown }).state;
      if (!state || typeof state !== 'object') return [];
      const param = Object.values(state as Record<string, unknown>).find(isParamArray);
      return param ? param.value : [];
    }

    function isParamArray(value: unknown): value is { kind: 'Param'; value: unknown[] } {
      return (
        Boolean(value) &&
        typeof value === 'object' &&
        (value as { kind?: unknown }).kind === 'Param' &&
        Array.isArray((value as { value?: unknown }).value)
      );
    }
  });
}

export async function dispatchSwappedDimensionOrder(page: Page, message: string): Promise<void> {
  await page.evaluate(async (dispatchMessage) => {
    const bridge = bridgeWithStateDispatch();
    const base = await readDimensionOrder(bridge);
    if (base.length < 2) throw new Error('Expected dimension order with >= 2 entries');

    const swapped = [...base];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    await bridge.dispatch(
      { callId: crypto.randomUUID(), name: 'parallel_coords.set_dimension_order', params: { order: swapped } },
      { source: 'debug', message: dispatchMessage },
    );

    async function readDimensionOrder(bridge: { getState: () => Promise<unknown> }): Promise<string[]> {
      const snap = await bridge.getState();
      const param = firstParamArray(snap);
      return param.map(String);
    }

    function bridgeWithStateDispatch(): {
      getState: () => Promise<unknown>;
      dispatch: (call: unknown, options: unknown) => Promise<unknown>;
    } {
      const bridge = (
        globalThis as typeof globalThis & {
          __vacp?: { getState?: () => Promise<unknown>; dispatch?: (call: unknown, options: unknown) => Promise<unknown> };
        }
      ).__vacp;
      if (!bridge || typeof bridge.getState !== 'function') throw new Error('Missing bridge.getState');
      if (typeof bridge.dispatch !== 'function') throw new Error('Missing bridge.dispatch');
      return { getState: bridge.getState.bind(bridge), dispatch: bridge.dispatch.bind(bridge) };
    }

    function firstParamArray(snap: unknown): unknown[] {
      if (!snap || typeof snap !== 'object') return [];
      const state = (snap as { state?: unknown }).state;
      if (!state || typeof state !== 'object') return [];
      const param = Object.values(state as Record<string, unknown>).find(isParamArray);
      return param ? param.value : [];
    }

    function isParamArray(value: unknown): value is { kind: 'Param'; value: unknown[] } {
      return (
        Boolean(value) &&
        typeof value === 'object' &&
        (value as { kind?: unknown }).kind === 'Param' &&
        Array.isArray((value as { value?: unknown }).value)
      );
    }
  }, message);
}
