export function request<T>(signal: AbortSignal, run: () => Promise<T> | T): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return run();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
