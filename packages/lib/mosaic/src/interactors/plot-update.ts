import type { VgplotPlotLike } from '../types';

export async function awaitPlotUpdate(plot: VgplotPlotLike, timeoutMs = 750): Promise<void> {
  // vgplot plots expose an update() method, but some implementations may return a promise
  // that never resolves (for example if an update gets superseded). We therefore only
  // wait a short, bounded time to encourage cross-filter propagation without hanging.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update = (plot as any)?.update;
  if (typeof update !== 'function') return;
  try {
    const p = Promise.resolve(update.call(plot));
    await Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch {
    // Best-effort: never fail the action because a render update failed.
  }
}

