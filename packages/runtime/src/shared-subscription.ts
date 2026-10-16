/** One owned connection per resource, shared by independent consumers. */
export function createSharedSubscription<Resource extends object>(
  connect: (resource: Resource, invalidate: () => void) => () => void,
) {
  const connections = new WeakMap<Resource, { listeners: Set<() => void>; disconnect: () => void }>();
  return (resource: Resource, listener: () => void): (() => void) => {
    let connection = connections.get(resource);
    if (!connection) {
      const listeners = new Set<() => void>();
      const disconnect = connect(resource, () => {
        for (const notify of [...listeners]) {
          try {
            notify();
          } catch {
            /* A subscriber cannot interrupt its source or other subscribers. */
          }
        }
      });
      connection = { listeners, disconnect };
      connections.set(resource, connection);
    }
    const notify = () => listener();
    connection.listeners.add(notify);
    return () => {
      if (!connection.listeners.delete(notify) || connection.listeners.size) return;
      connections.delete(resource);
      connection.disconnect();
    };
  };
}
