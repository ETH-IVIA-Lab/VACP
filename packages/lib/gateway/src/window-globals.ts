const DEFAULT_GLOBAL_KEY = '__vacp';

export function resolveVacpGlobalKey(globalKey: unknown): string {
  return typeof globalKey === 'string' && globalKey.length ? globalKey : DEFAULT_GLOBAL_KEY;
}

function safeDelete(root: Record<string, unknown>, key: string): void {
  try {
    delete root[key];
  } catch {
    root[key] = undefined;
  }
}

/**
 * When `expose-bridge=0`, VACP integrations should not leave any globals behind.
 *
 * This removes:
 * - `window[globalKey]` (the bridge)
 * - any `window[${globalKey}*]` companion globals created by providers (DuckDB caches, etc.)
 */
export function purgeVacpWindowGlobals(globalKey: string): void {
  if (!globalKey) return;
  const root = globalThis as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(root)) {
    if (key === globalKey || key.startsWith(globalKey)) safeDelete(root, key);
  }
}
