import { createContext, use, useSyncExternalStore } from 'react';
import type { PresenceEngine } from './engine';
import type { PresenceConfig } from './options';

export const PresenceContext = createContext<{ engine: PresenceEngine; config: PresenceConfig } | null>(null);

export function usePresence() {
  const value = use(PresenceContext);
  if (!value) throw new Error('Presence components render inside a presence renderer');
  return value;
}

/** Reduced motion, and stillness while the document is hidden. */
export function useMotion() {
  const { engine } = usePresence();
  return useSyncExternalStore(engine.motion.subscribe, engine.motion.get);
}
