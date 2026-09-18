import type { VacpChangeSource } from '@vacp/protocol';

export function createRuntimeNotifier(args: {
  getSource: () => VacpChangeSource;
  refresh: (options: { source: VacpChangeSource; message: string }) => Promise<unknown> | unknown;
}) {
  const { getSource, refresh } = args;

  const refreshRuntimeNow = (source: VacpChangeSource, message: string) => {
    void Promise.resolve(refresh({ source, message })).catch(() => {});
  };

  let pendingTimer: number | null = null;
  let pending: { source: VacpChangeSource; message: string } | null = null;

  const notifyRuntime = (message: string, opts?: { immediate?: boolean }) => {
    const source = getSource();

    if (opts?.immediate) {
      refreshRuntimeNow(source, message);

      return;
    }

    pending = { source, message };

    if (pendingTimer !== null) return;
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      const next = pending;
      pending = null;

      if (!next) return;
      refreshRuntimeNow(next.source, next.message);
    }, 120);
  };

  return { notifyRuntime };
}

export function wrapUpdate(owner: unknown, label: string, notifyRuntime: (message: string) => void) {
  const obj = owner as { update?: (...args: unknown[]) => unknown };

  if (!obj || typeof obj.update !== 'function') return;

  if ((obj.update as { __vacpWrapped?: boolean }).__vacpWrapped) return;
  const orig = obj.update;

  const wrapped = (...args: unknown[]) => {
    const out = orig.apply(obj, args);
    notifyRuntime(label);

    return out;
  };

  (wrapped as { __vacpWrapped?: boolean }).__vacpWrapped = true;
  obj.update = wrapped;
}
