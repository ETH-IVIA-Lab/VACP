import type { VegaViewLike } from './types';

export function tryGetSignal(view: VegaViewLike, name: string) {
  try {
    return view.signal(name);
  } catch {
    return undefined;
  }
}

export function trySetSignal(view: VegaViewLike, name: string, value: unknown): boolean {
  try {
    view.signal(name, value as any);

    return true;
  } catch {
    return false;
  }
}

export function signalNamesFromView(view: VegaViewLike): string[] {
  try {
    const st = view.getState();

    if (!st || typeof st !== 'object') return [];
    const signals = (st as { signals?: unknown }).signals;

    if (!signals || typeof signals !== 'object') return [];

    return Object.keys(signals as Record<string, unknown>);
  } catch {
    return [];
  }
}
