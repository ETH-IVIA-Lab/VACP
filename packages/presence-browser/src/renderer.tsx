import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { PresenceNavigation, PresenceRenderer } from '@ethivia/vacp-presence';
import { PresenceContext } from './context';
import { createPresenceEngine } from './engine';
import { resolvePresenceOptions, type BrowserPresenceOptions } from './options';
import { PresenceOverlay } from './overlay';
import { createPointerMotion, type PointerMotion } from './pointer-motion';
import { createSlots, type Slot } from './slots';
import { presenceStyleSheet } from './stylesheet';

/**
 * Render presence frames into an isolated shadow root. React commits only when what a label shows
 * changes; each pointer's motion controller moves the overlay on every frame. When `render` returns,
 * the frame's words are committed and its motion has started, so arrival waits and layout reads see it.
 */
export function createBrowserPresenceRenderer(options: BrowserPresenceOptions = {}): PresenceRenderer & {
  invalidateLayout(): void;
} {
  const config = resolvePresenceOptions(options);
  const doc = options.document ?? document;
  const engine = createPresenceEngine(doc, config.motion);
  const host = doc.createElement('div');
  host.setAttribute('data-vacp-presence', '');
  // Page styles reach the host but never the shadow root, so the host alone pins itself as a fixed, inert layer.
  host.style.cssText = `all:initial;position:fixed;inset:0;pointer-events:none;contain:strict;z-index:${config.zIndex}`;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [presenceStyleSheet(doc)];
  doc.documentElement.append(host);
  const root = createRoot(shadow);
  const context = { engine, config };
  const slots = createSlots({ describe: config.describe, cursor: config.cursor.resolve });
  const pointers = new Map<number, PointerMotion>();
  /** The slot each pointer last drew, so a pointer measures its label only when its content changed. */
  const drawn = new Map<number, Slot>();
  let navigation: PresenceNavigation | undefined;
  let disposed = false;
  /** A cursor acknowledged an execution during this frame, so its press is drawn before `render` returns. */
  let acknowledged = false;
  const commit = () =>
    root.render(
      <PresenceContext value={context}>
        <PresenceOverlay slots={slots.list()} navigation={navigation} pointers={pointers} />
      </PresenceContext>,
    );
  const release = (removed: readonly Slot[]) => {
    for (const slot of removed) {
      const pointer = pointers.get(slot.id);
      if (!pointer) continue;
      slots.remember(slot.key, pointer.position());
      pointer.dispose();
      pointers.delete(slot.id);
      drawn.delete(slot.id);
    }
  };
  const exited = (id: number) => {
    const slot = slots.list().find((entry) => entry.id === id);
    if (disposed || !slot || !slots.exited(id)) return;
    release([slot]);
    commit();
  };
  const stopResize = engine.onResize(() => {
    for (const pointer of pointers.values()) pointer.reflow();
  });
  const stopMotion = engine.motion.subscribe(() => {
    if (engine.motion.get().still) {
      const settled = slots.settle();
      release(settled);
      if (settled.length) commit();
    }
    for (const pointer of pointers.values()) pointer.settle();
  });
  return {
    invalidateLayout() {
      for (const pointer of pointers.values()) pointer.invalidate();
    },
    render(frame) {
      if (disposed) return;
      const { changed, removed } = slots.update(frame.activities, frame.navigation, engine.motion.get().still);
      release(removed);
      for (const slot of slots.list())
        if (!pointers.has(slot.id))
          pointers.set(
            slot.id,
            createPointerMotion({
              engine,
              config,
              start: slots.recall(slot.key),
              stack: slot.stack,
              exited: () => exited(slot.id),
              acknowledged: () => {
                acknowledged = true;
              },
            }),
          );
      if (changed || frame.navigation !== navigation) {
        navigation = frame.navigation;
        // The port is imperative: the frame's words are in the document before its motion starts.
        flushSync(commit);
      }
      for (const slot of slots.list()) {
        const pointer = pointers.get(slot.id)!;
        pointer.exit(slot.exiting);
        if (slot.exiting) continue;
        pointer.sync(slots.activity(slot.id)!, frame.reason, drawn.get(slot.id) !== slot);
        drawn.set(slot.id, slot);
      }
      if (acknowledged) flushSync(() => {});
      acknowledged = false;
    },
    arrive(executionId, signal) {
      const pointer = [...pointers.values()].find((entry) => entry.travelling(executionId));
      return pointer ? pointer.arrival(signal) : Promise.resolve();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopMotion();
      stopResize();
      for (const pointer of pointers.values()) pointer.dispose();
      pointers.clear();
      engine.dispose();
      host.remove();
      // A host may dispose from inside its own React lifecycle, where a synchronous unmount is refused.
      queueMicrotask(() => root.unmount());
    },
  };
}
