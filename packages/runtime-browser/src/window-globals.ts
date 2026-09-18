const DEFAULT_GLOBAL_KEY = '__vacp';

export function resolveVacpGlobalKey(globalKey: string | undefined): string {
  return globalKey?.length ? globalKey : DEFAULT_GLOBAL_KEY;
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

  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (key === globalKey || key.startsWith(globalKey)) {
      if (!Reflect.deleteProperty(globalThis, key)) Object.assign(globalThis, { [key]: undefined });
    }
  }
}
