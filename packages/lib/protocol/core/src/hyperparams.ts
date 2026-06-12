export type VacpHyperParams = Readonly<{
  /**
   * Whether to enable the in-page debug UI overlay (defaults to true).
   *
   * Sources, highest to lowest priority:
   * - URL params: `?vacp-debug=0|1`
   * - env var: `VACP_DEBUG_UI=0|1`
   * - localStorage: `vacp:debug=0|1`
   * - default: true
   */
  debugUi: boolean;
  /**
   * Whether to expose the in-page JS bridge on `window` (defaults to true).
   *
   * When disabled, VACP integrations should avoid installing `window.__vacp`
   * entirely (and remove it if already present).
   *
   * Sources, highest to lowest priority:
   * - URL params: `?expose-bridge=0|1` or `?vacp-expose-bridge=0|1`
   *   (camelCase aliases are also accepted)
   * - env var: `VACP_EXPOSE_BRIDGE=0|1`
   * - localStorage: `vacp:expose-bridge=0|1`
   * - default: true
   */
  exposeBridge: boolean;
  /**
   * Whether to inject a JSON DOM snapshot `<script>` tag (defaults to true).
   *
   * Sources, highest to lowest priority:
   * - URL param: `?vacp-dom-snapshot=0|1`
   * - env var: `VACP_DOM_SNAPSHOT=0|1`
   * - localStorage: `vacp:dom-snapshot=0|1`
   * - default: true
   */
  domSnapshot: boolean;
  /**
   * Whether to register the raw SQL DataHandle action (defaults to true).
   *
   * Sources, highest to lowest priority:
   * - URL param: `?enable-sql=0|1`
   * - env var: `VACP_ENABLE_SQL=0|1`
   * - localStorage: `vacp:enable-sql=0|1`
   * - default: true
   */
  enableSql: boolean;
}>;

export type VacpHyperParamKey = keyof VacpHyperParams;

export type VacpHyperParamSource = 'url' | 'env' | 'localStorage' | 'default';

export type VacpHyperParamDetail = Readonly<{
  value: boolean;
  source: VacpHyperParamSource;
  default: boolean;
  urlKeys: readonly string[];
  envKeys: readonly string[];
  localStorageKey?: string;
  raw?: string;
}>;

export type VacpHyperParamResolution = Readonly<{
  values: VacpHyperParams;
  details: Readonly<Record<VacpHyperParamKey, VacpHyperParamDetail>>;
}>;

type BooleanResolution = { value: boolean; source: VacpHyperParamSource; raw?: string };

type BooleanSpec = Readonly<{
  default: boolean;
  urlKeys: readonly string[];
  envKeys: readonly string[];
  localStorageKey?: string;
}>;

const HYPER_PARAM_KEYS = [
  'debugUi',
  'exposeBridge',
  'domSnapshot',
  'enableSql',
] as const satisfies readonly VacpHyperParamKey[];

const BOOL_SPECS: Record<VacpHyperParamKey, BooleanSpec> = {
  debugUi: {
    default: true,
    urlKeys: ['vacp-debug'],
    envKeys: ['VACP_DEBUG_UI'],
    localStorageKey: 'vacp:debug',
  },
  exposeBridge: {
    default: true,
    urlKeys: ['expose-bridge', 'vacp-expose-bridge'],
    envKeys: ['VACP_EXPOSE_BRIDGE'],
    localStorageKey: 'vacp:expose-bridge',
  },
  domSnapshot: {
    default: true,
    urlKeys: ['vacp-dom-snapshot'],
    envKeys: ['VACP_DOM_SNAPSHOT'],
    localStorageKey: 'vacp:dom-snapshot',
  },
  enableSql: {
    default: true,
    urlKeys: ['enable-sql'],
    envKeys: ['VACP_ENABLE_SQL'],
    localStorageKey: 'vacp:enable-sql',
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
    if (!fromUrl.raw) return { value: true, source: fromUrl.source, raw: fromUrl.raw };
    return { value: parseBooleanish(fromUrl.raw) ?? true, source: fromUrl.source, raw: fromUrl.raw };
  }

  const fromEnv = resolveFromEnv(ctx.env, spec.envKeys);
  if (fromEnv) {
    if (!fromEnv.raw) return { value: true, source: fromEnv.source, raw: fromEnv.raw };
    return { value: parseBooleanish(fromEnv.raw) ?? true, source: fromEnv.source, raw: fromEnv.raw };
  }

  const fromStorage = resolveFromLocalStorage(ctx.storage, spec.localStorageKey);
  if (fromStorage) {
    const parsed = parseBooleanish(fromStorage.raw);
    if (parsed !== null) return { value: parsed, source: fromStorage.source, raw: fromStorage.raw };
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
  return resolveVacpHyperParamDetails(ctx).values;
}

export function resolveVacpHyperParamDetails(ctx?: {
  url?: string;
  env?: Record<string, unknown>;
  storage?: Storage | null;
}): VacpHyperParamResolution {
  const details = {} as Record<VacpHyperParamKey, VacpHyperParamDetail>;
  const values = {} as Record<VacpHyperParamKey, boolean>;

  for (const key of HYPER_PARAM_KEYS) {
    const spec = BOOL_SPECS[key];
    const resolved = resolveBoolean(spec, {
      url: ctx?.url,
      env: ctx?.env,
      storage: ctx?.storage,
    });
    values[key] = resolved.value;
    details[key] = {
      value: resolved.value,
      source: resolved.source,
      raw: resolved.raw,
      default: spec.default,
      urlKeys: spec.urlKeys,
      envKeys: spec.envKeys,
      localStorageKey: spec.localStorageKey,
    };
  }

  return { values: values as unknown as VacpHyperParams, details };
}

/**
 * Convenience wrapper for browser apps:
 * - reads URL from `window.location.href` (if present)
 * - reads env from `import.meta.env` (Vite) or `process.env` (Node/bundlers)
 * - reads storage from `localStorage` (if present)
 */
export function getVacpHyperParams(): VacpHyperParams {
  return getVacpHyperParamResolution().values;
}

export function getVacpHyperParamResolution(): VacpHyperParamResolution {
  return resolveVacpHyperParamDetails({
    url: getDefaultUrl(),
    env: getDefaultEnvRecord(),
    storage: getDefaultStorage(),
  });
}

export function setVacpHyperParamStorageOverride(
  key: VacpHyperParamKey,
  value: boolean,
  storage: Pick<Storage, 'setItem'> | null = getDefaultStorage(),
): boolean {
  const spec = BOOL_SPECS[key];
  if (!storage || !spec.localStorageKey) return false;
  try {
    storage.setItem(spec.localStorageKey, value ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export function clearVacpHyperParamStorageOverride(
  key: VacpHyperParamKey,
  storage: Pick<Storage, 'removeItem'> | null = getDefaultStorage(),
): boolean {
  const spec = BOOL_SPECS[key];
  if (!storage || !spec.localStorageKey) return false;
  try {
    storage.removeItem(spec.localStorageKey);
    return true;
  } catch {
    return false;
  }
}
