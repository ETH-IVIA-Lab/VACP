import {
  type AgentPresence,
  createAgentPresence,
  type PresenceOptions,
  type PresenceSource,
} from '@ethivia/vacp-sdk/presence';
import type { PresenceAppearance } from './options';
import { createPresenceOverlayRenderer } from './renderer';

type Options = Omit<PresenceOptions, 'renderer'> & { appearance?: PresenceAppearance };

/** Browser wiring only. The host owns any supplied provenance replay controller. */
export function createPresenceOverlay(runtime: PresenceSource, options: Options = {}): AgentPresence {
  const renderer = createPresenceOverlayRenderer(options.appearance);
  let presence: AgentPresence;
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
