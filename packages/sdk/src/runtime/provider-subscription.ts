export function createProviderSubscription(bind: (notify: () => void) => () => void, { quietMs }: { quietMs: number }) {
  const listeners = new Set<() => void>();
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const notify = () => {
    if (disposed || !listeners.size || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // One consumer cannot interrupt source observation for other consumers.
        }
      }
    }, quietMs);
  };
  const detach = () => {
    clearTimeout(timer);
    timer = undefined;
    const cleanup = release;
    release = undefined;
    cleanup?.();
  };
  return {
    subscribe: (listener: () => void) => {
      if (disposed) throw new Error('Provider subscription is disposed');
      const subscription = () => listener();
      listeners.add(subscription);
      try {
        release ??= bind(notify);
      } catch (error) {
        listeners.delete(subscription);
        if (!listeners.size) detach();
        throw error;
      }
      return () => {
        listeners.delete(subscription);
        if (!listeners.size) detach();
      };
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
      detach();
    },
  };
}
