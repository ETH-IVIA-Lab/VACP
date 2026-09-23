import type { VacpFocus, VacpSourceId } from '@vacp/protocol';
import { validPresenceTarget } from './geometry';
import type { PresenceBinding } from './types';

export type PresenceFocus = { focus: VacpFocus; sourceId: VacpSourceId; bindingId?: string };

/** One binding inventory for live execution, replay and layout invalidation. */
export function createPresenceTargets(
  signal: AbortSignal,
  invalidate: (bindingId?: string) => void,
  report: (error: unknown) => void,
) {
  const bindings = new Map<string, PresenceBinding>();
  const releases = new Map<string, () => void>();
  return {
    async resolve(target: PresenceFocus, requested: AbortSignal) {
      const binding = target.bindingId
        ? bindings.get(target.bindingId)
        : [...bindings.values()].find((value) => value.sourceId === target.sourceId);
      if (!binding || binding.sourceId !== target.sourceId || binding.signal.aborted) return null;
      const lifetime = AbortSignal.any([signal, requested, binding.signal]);
      lifetime.throwIfAborted();
      const result = await binding.resolve(target.focus, { signal: lifetime });
      lifetime.throwIfAborted();
      return result && validPresenceTarget(result) ? result : null;
    },
    attach(binding: PresenceBinding, detached: () => void) {
      signal.throwIfAborted();
      binding.signal.throwIfAborted();
      if (bindings.has(binding.id)) throw new Error('Presentation binding is already attached');
      bindings.set(binding.id, binding);
      let unsubscribe: (() => void) | undefined;
      try {
        unsubscribe = binding.subscribe?.(() => invalidate(binding.id));
      } catch (error) {
        bindings.delete(binding.id);
        throw error;
      }
      const detach = () => {
        if (!bindings.delete(binding.id)) return;
        releases.delete(binding.id);
        binding.signal.removeEventListener('abort', detach);
        try {
          unsubscribe?.();
        } catch (error) {
          report(error);
        } finally {
          detached();
          invalidate(binding.id);
        }
      };
      releases.set(binding.id, detach);
      binding.signal.addEventListener('abort', detach, { once: true });
      if (binding.signal.aborted) detach();
      else invalidate(binding.id);
      return detach;
    },
    dispose() {
      for (const release of [...releases.values()]) release();
    },
  };
}
