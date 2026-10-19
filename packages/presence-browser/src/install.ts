import { createAgentPresence, type PresenceOptions, type PresenceSource } from '@ethivia/vacp-presence-core';
import type { BrowserPresenceOptions } from './options';
import { createBrowserPresenceRenderer } from './renderer';

type Options = Omit<PresenceOptions, 'renderer'> & { appearance?: BrowserPresenceOptions };

/** Browser wiring only. The host owns any supplied provenance replay controller. */
export function createBrowserPresence(runtime: PresenceSource, options: Options = {}) {
  const renderer = createBrowserPresenceRenderer(options.appearance);
  let presence: ReturnType<typeof createAgentPresence>;
  try {
    presence = createAgentPresence(runtime, { ...options, renderer });
  } catch (error) {
    renderer.dispose?.();
    throw error;
  }
  const view = (options.appearance?.document ?? document).defaultView!;
  let frame = 0;
  const invalidate = () => {
    renderer.invalidateLayout();
    if (!frame)
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        presence.invalidateTargets();
      });
  };
  view.addEventListener('scroll', invalidate, { capture: true, passive: true });
  view.addEventListener('resize', invalidate);
  view.visualViewport?.addEventListener('scroll', invalidate);
  view.visualViewport?.addEventListener('resize', invalidate);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    view.cancelAnimationFrame(frame);
    view.removeEventListener('scroll', invalidate, true);
    view.removeEventListener('resize', invalidate);
    view.visualViewport?.removeEventListener('scroll', invalidate);
    view.visualViewport?.removeEventListener('resize', invalidate);
    presence.dispose();
    runtime.signal.removeEventListener('abort', dispose);
  };
  runtime.signal.addEventListener('abort', dispose, { once: true });
  return {
    ...presence,
    dispose,
  };
}
