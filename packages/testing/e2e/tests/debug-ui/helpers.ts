import type { Page } from '@playwright/test';

type DebugBridgeWaitOptions = {
  requireRuntime?: boolean;
};

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
