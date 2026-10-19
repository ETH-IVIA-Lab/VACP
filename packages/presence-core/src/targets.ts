import type { VacpFocus, VacpRef, VacpSourceId } from '@ethivia/vacp-protocol';
import { validPresenceTarget } from './geometry';
import type { PresenceBinding } from './types';

export type PresenceFocus = { focus: VacpFocus; sourceId: VacpSourceId; bindingId?: string };

/**
 * Where a step points, in order: its focus, else each node it changes. A pointer rests on the first
 * place a surface can show, so a step that sets several inputs points at the first one on screen.
 */
export function stepPlaces(
  focus: VacpFocus | undefined,
  affects: readonly VacpRef[] | undefined,
  owner: (ref: VacpRef) => Omit<PresenceFocus, 'focus'> | undefined,
): PresenceFocus[] {
  const wanted = focus ? [focus] : (affects ?? []).map((ref) => ({ ref }));
  return wanted.flatMap((focus) => {
    const at = owner(focus.ref);
    return at ? [{ focus, ...at }] : [];
  });
}

/**
 * One binding inventory for live execution, replay and layout invalidation. A binding's layout witness
 * runs only while something watches its source: a pointer resting on it, or a recorded frame shown on it.
 */
export function createPresenceTargets(
  signal: AbortSignal,
  invalidate: (binding: PresenceBinding) => void,
  report: (error: unknown) => void,
) {
  const bindings = new Map<string, PresenceBinding>();
  const releases = new Map<string, () => void>();
  const interest = new Map<VacpSourceId, number>();
  const witnesses = new Map<PresenceBinding, () => void>();
  const stopWitness = (stop: () => void) => {
    try {
      stop();
    } catch (error) {
      report(error);
    }
  };
  const observe = (binding: PresenceBinding) => {
    if (witnesses.has(binding) || !binding.subscribe) return;
    let stop: () => void;
    try {
      stop = binding.subscribe(() => invalidate(binding));
    } catch (error) {
      return report(error);
    }
    // Subscribing can call back into presence, which may detach the binding or release its source.
    if (bindings.get(binding.id) === binding && interest.has(binding.sourceId)) witnesses.set(binding, stop);
    else stopWitness(stop);
  };
  const ignore = (binding: PresenceBinding) => {
    const stop = witnesses.get(binding);
    witnesses.delete(binding);
    if (stop) stopWitness(stop);
  };
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
    /** Keep the source's layout witness running until the returned function is called. */
    watch(sourceId: VacpSourceId) {
      const count = (interest.get(sourceId) ?? 0) + 1;
      interest.set(sourceId, count);
      if (count === 1) for (const binding of bindings.values()) if (binding.sourceId === sourceId) observe(binding);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = interest.get(sourceId)! - 1;
        if (left) return void interest.set(sourceId, left);
        interest.delete(sourceId);
        for (const binding of bindings.values()) if (binding.sourceId === sourceId) ignore(binding);
      };
    },
    attach(binding: PresenceBinding, detached: () => void) {
      signal.throwIfAborted();
      binding.signal.throwIfAborted();
      if (bindings.has(binding.id)) throw new Error('Presentation binding is already attached');
      bindings.set(binding.id, binding);
      if (interest.has(binding.sourceId)) observe(binding);
      const detach = () => {
        // A handle kept from an earlier attachment leaves a newer binding with the same ID in place.
        if (bindings.get(binding.id) !== binding) return;
        bindings.delete(binding.id);
        releases.delete(binding.id);
        binding.signal.removeEventListener('abort', detach);
        ignore(binding);
        detached();
        invalidate(binding);
      };
      releases.set(binding.id, detach);
      binding.signal.addEventListener('abort', detach, { once: true });
      if (binding.signal.aborted) detach();
      else invalidate(binding);
      return detach;
    },
    dispose() {
      for (const release of [...releases.values()]) release();
    },
  };
}
