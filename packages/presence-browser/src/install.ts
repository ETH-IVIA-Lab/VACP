import type { VacpProvider } from '@vacp/protocol';
import {
  createAgentPresence,
  type PresenceBinding,
  type PresenceOptions,
  type PresenceSource,
} from '@vacp/presence-core';
import { createBrowserPresenceRenderer, type BrowserPresenceOptions } from './renderer';

type BrowserPresenceSource = PresenceSource & {
  getProviderBinding(provider: VacpProvider): { id: string; signal: AbortSignal };
};

/** Compose the default renderer with a headless viewer and generation-scoped source bindings. */
export function createBrowserPresence(
  runtime: BrowserPresenceSource,
  options: Omit<PresenceOptions, 'renderer'> & { appearance?: BrowserPresenceOptions } = {},
) {
  const renderer = createBrowserPresenceRenderer(options.appearance);
  let presence: ReturnType<typeof createAgentPresence>;
  try {
    presence = createAgentPresence(runtime, { ...options, renderer });
  } catch (error) {
    renderer.dispose?.();
    throw error;
  }
  return {
    ...presence,
    attach(provider: VacpProvider, targets: Pick<PresenceBinding, 'resolve' | 'subscribe'>) {
      return presence.attach({ ...targets, ...runtime.getProviderBinding(provider), sourceId: provider.source.id });
    },
  };
}
