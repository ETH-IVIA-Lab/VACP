/** Release a viewer's wait on cancellation, even when the host ignores its signal. */
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const finish = (value?: T) => {
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const cancel = () => finish();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    void work.then(finish, (error) => {
      signal.removeEventListener('abort', cancel);
      reject(error);
    });
  });
}
