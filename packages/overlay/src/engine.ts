export type MotionState = { reduced: boolean; still: boolean };

/**
 * Services every pointer of one overlay shares: one animation frame loop, the motion preference, and
 * the viewport size. Time and frames come from the owning document's window, so an overlay in an
 * iframe runs on that window's clock.
 */
export function createPresenceEngine(doc: Document, motion: 'system' | 'reduced' | 'full') {
  const view = doc.defaultView;
  if (!view) throw new Error('Presence renderer requires a live document');
  const media = view.matchMedia('(prefers-reduced-motion: reduce)');
  const read = (): MotionState => {
    const reduced = motion === 'reduced' || (motion !== 'full' && media.matches);
    return { reduced, still: reduced || doc.hidden };
  };
  let state = read();
  // Read once per resize, so frames never ask for the viewport after writing transforms.
  let viewport = { width: view.innerWidth, height: view.innerHeight };
  const listeners = new Set<() => void>();
  const resized = new Set<() => void>();
  const tasks = new Set<(now: number) => void>();
  let frame = 0;
  let disposed = false;
  const tick = (now: number) => {
    frame = 0;
    for (const task of [...tasks]) task(now);
    schedule();
  };
  const schedule = () => {
    const run = !disposed && !doc.hidden && tasks.size > 0;
    if (run && !frame) frame = view.requestAnimationFrame(tick);
    else if (!run && frame) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const onMotion = () => {
    const next = read();
    if (next.reduced !== state.reduced || next.still !== state.still) {
      state = next;
      for (const listener of listeners) listener();
    }
    schedule();
  };
  const onResize = () => {
    viewport = { width: view.innerWidth, height: view.innerHeight };
    for (const listener of resized) listener();
  };
  media.addEventListener('change', onMotion);
  doc.addEventListener('visibilitychange', onMotion);
  view.addEventListener('resize', onResize);
  return {
    view,
    now: () => view.performance.now(),
    viewport: () => viewport,
    /** Hear every viewport resize, after the new size is recorded. */
    onResize(listener: () => void) {
      resized.add(listener);
      return () => {
        resized.delete(listener);
      };
    },
    motion: {
      get: () => state,
      subscribe(this: void, listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    /** Run `task` on every frame until the returned function is called. */
    animate(task: (now: number) => void) {
      tasks.add(task);
      schedule();
      return () => {
        tasks.delete(task);
        schedule();
      };
    },
    dispose() {
      disposed = true;
      tasks.clear();
      listeners.clear();
      resized.clear();
      schedule();
      media.removeEventListener('change', onMotion);
      doc.removeEventListener('visibilitychange', onMotion);
      view.removeEventListener('resize', onResize);
    },
  };
}

export type PresenceEngine = ReturnType<typeof createPresenceEngine>;
