export type VacpHyperParams = Readonly<{
  /**
   * Whether to enable the in-page debug UI overlay (defaults to false).
   *
   * Sources (highest → lowest priority):
   * - URL params: `?vacp-debug=1`
   * - env var: `VACP_DEBUG_UI=1`
   * - localStorage: `vacp:debug=1`
   * - default: false
   */
  debugUi: boolean;
  /**
   * Whether to inject a JSON DOM snapshot `<script>` tag (defaults to true).
   *
   * Sources (highest → lowest priority):
   * - URL param: `?vacp-dom-snapshot=0|1`
   * - env var: `VACP_DOM_SNAPSHOT=0|1`
   * - default: true
   */
  domSnapshot: boolean;
  /**
   * Whether example apps should include "heavy" demo assets/specs (defaults to false).
   *
   * Sources (highest → lowest priority):
   * - URL param: `?vacp-examples-heavy=0|1`
   * - env var: `VACP_EXAMPLES_HEAVY=0|1`
   * - default: false
   */
  examplesHeavy: boolean;
}>;

type BooleanSource = 'url' | 'env' | 'localStorage' | 'default';

type BooleanResolution = { value: boolean; source: BooleanSource };

type BooleanSpec = Readonly<{
  default: boolean;
  urlKeys: readonly string[];
  envKeys: readonly string[];
  localStorageKey?: string;
}>;

const BOOL_SPECS: Record<keyof VacpHyperParams, BooleanSpec> = {
  debugUi: {
    default: false,
    urlKeys: ['vacp-debug'],
    envKeys: ['VACP_DEBUG_UI'],
    localStorageKey: 'vacp:debug',
  },
  domSnapshot: {
    default: true,
    urlKeys: ['vacp-dom-snapshot'],
    envKeys: ['VACP_DOM_SNAPSHOT'],
  },
  examplesHeavy: {
    default: false,
    urlKeys: ['vacp-examples-heavy'],
    envKeys: ['VACP_EXAMPLES_HEAVY'],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBooleanish(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['1', 'true', 't', 'yes', 'y', 'on', 'enable', 'enabled'].includes(v)) return true;
  if (['0', 'false', 'f', 'no', 'n', 'off', 'disable', 'disabled'].includes(v)) return false;
  return null;
}

function resolveFromUrl(url: string | undefined, keys: readonly string[]): { raw: string; source: 'url' } | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://localhost');
    for (const k of keys) {
      if (u.searchParams.has(k)) {
        const raw = u.searchParams.get(k) ?? '';
        return { raw, source: 'url' };
      }
      const alias = kebabToCamel(k);
      if (alias !== k && u.searchParams.has(alias)) {
        const raw = u.searchParams.get(alias) ?? '';
        return { raw, source: 'url' };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function resolveFromEnv(
  env: Record<string, unknown> | undefined,
  keys: readonly string[],
): { raw: string; source: 'env' } | null {
  if (!env) return null;
  for (const k of keys) {
    const v = env[k];
    if (v === undefined) continue;
    if (typeof v === 'string') return { raw: v, source: 'env' };
    if (typeof v === 'boolean') return { raw: v ? '1' : '0', source: 'env' };
    if (typeof v === 'number' && Number.isFinite(v)) return { raw: String(v), source: 'env' };
  }
  return null;
}

function resolveFromLocalStorage(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key: string | undefined,
): { raw: string; source: 'localStorage' } | null {
  if (!storage || !key) return null;
  try {
    const v = storage.getItem(key);
    return typeof v === 'string' ? { raw: v, source: 'localStorage' } : null;
  } catch {
    return null;
  }
}

function resolveBoolean(
  spec: BooleanSpec,
  ctx: { url?: string; env?: Record<string, unknown>; storage?: Storage | null },
): BooleanResolution {
  const fromUrl = resolveFromUrl(ctx.url, spec.urlKeys);
  if (fromUrl) {
    if (!fromUrl.raw) return { value: true, source: fromUrl.source };
    return { value: parseBooleanish(fromUrl.raw) ?? true, source: fromUrl.source };
  }

  const fromEnv = resolveFromEnv(ctx.env, spec.envKeys);
  if (fromEnv) {
    if (!fromEnv.raw) return { value: true, source: fromEnv.source };
    return { value: parseBooleanish(fromEnv.raw) ?? true, source: fromEnv.source };
  }

  const fromStorage = resolveFromLocalStorage(ctx.storage, spec.localStorageKey);
  if (fromStorage) {
    const parsed = parseBooleanish(fromStorage.raw);
    if (parsed !== null) return { value: parsed, source: fromStorage.source };
  }

  return { value: spec.default, source: 'default' };
}

function getDefaultEnvRecord(): Record<string, unknown> | undefined {
  const envFromImportMeta = (import.meta as unknown as { env?: unknown }).env;
  if (isRecord(envFromImportMeta)) return envFromImportMeta;

  const anyProcess = globalThis as unknown as { process?: unknown };
  if (isRecord(anyProcess.process) && isRecord((anyProcess.process as any).env)) {
    return (anyProcess.process as any).env as Record<string, unknown>;
  }

  return undefined;
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function getDefaultUrl(): string | undefined {
  try {
    return typeof window !== 'undefined' ? window.location.href : undefined;
  } catch {
    return undefined;
  }
}

export function resolveVacpHyperParams(ctx?: {
  url?: string;
  env?: Record<string, unknown>;
  storage?: Storage | null;
}): VacpHyperParams {
  const resolved = {
    debugUi: resolveBoolean(BOOL_SPECS.debugUi, {
      url: ctx?.url,
      env: ctx?.env,
      storage: ctx?.storage,
    }).value,
    domSnapshot: resolveBoolean(BOOL_SPECS.domSnapshot, {
      url: ctx?.url,
      env: ctx?.env,
      storage: ctx?.storage,
    }).value,
    examplesHeavy: resolveBoolean(BOOL_SPECS.examplesHeavy, {
      url: ctx?.url,
      env: ctx?.env,
      storage: ctx?.storage,
    }).value,
  } as const;
  return resolved;
}

/**
 * Convenience wrapper for browser apps:
 * - reads URL from `window.location.href` (if present)
 * - reads env from `import.meta.env` (Vite) or `process.env` (Node/bundlers)
 * - reads storage from `localStorage` (if present)
 */
export function getVacpHyperParams(): VacpHyperParams {
  return resolveVacpHyperParams({
    url: getDefaultUrl(),
    env: getDefaultEnvRecord(),
    storage: getDefaultStorage(),
  });
}
