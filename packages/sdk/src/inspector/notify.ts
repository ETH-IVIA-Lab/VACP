export function notify(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A consumer's renderer must not change request outcomes or interrupt other consumers.
    }
  }
}
