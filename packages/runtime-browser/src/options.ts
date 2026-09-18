/// <reference types="vite/client" />

import { z } from 'zod';

export type VacpBrowserOptions = Readonly<{
  /**
   * Whether to enable the in-page inspector (defaults to true).
   *
   * Sources, highest to lowest priority:
   * - URL params: `?vacp-inspector=0|1`
   * - env var: `VACP_INSPECTOR=0|1`
   * - localStorage: `vacp:inspector=0|1`
   * - default: true
   */
  inspector: boolean;
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

export type VacpBrowserOptionKey = keyof VacpBrowserOptions;

export type VacpBrowserOptionSource = 'url' | 'env' | 'localStorage' | 'default';

export type VacpBrowserOptionDetail = Readonly<{
  value: boolean;
  source: VacpBrowserOptionSource;
  default: boolean;
  urlKeys: readonly string[];
  envKeys: readonly string[];
  localStorageKey?: string;
  raw?: string;
}>;

export type VacpBrowserOptionResolution = Readonly<{
  values: VacpBrowserOptions;
  details: Readonly<Record<VacpBrowserOptionKey, VacpBrowserOptionDetail>>;
}>;

type BooleanResolution = { value: boolean; source: VacpBrowserOptionSource; raw?: string };

type BooleanSpec = Readonly<{
  default: boolean;
  urlKeys: readonly string[];
  envKeys: readonly string[];
  localStorageKey?: string;
}>;

const BOOL_SPECS: Record<VacpBrowserOptionKey, BooleanSpec> = {
  inspector: {
    default: true,
    urlKeys: ['vacp-inspector'],
    envKeys: ['VACP_INSPECTOR'],
    localStorageKey: 'vacp:inspector',
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

type EnvironmentValue = string | boolean | number | undefined;

type BrowserEnvironment = Record<string, EnvironmentValue>;

type OptionInput<Source extends VacpBrowserOptionSource> = { raw: string; source: Source };

export type VacpBrowserOptionContext = {
  url?: string;
  env?: BrowserEnvironment;
  storage?: Pick<Storage, 'getItem'> | null;
};

const envRecordSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.nan(), z.undefined()]));

const envValueSchema = z.union([
  z.string(),
  z.boolean().transform((value) => (value ? '1' : '0')),
  z.number().finite().transform(String),
]);

function parseBooleanish(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();

  if (!v) return null;

  if (['1', 'true', 't', 'yes', 'y', 'on', 'enable', 'enabled'].includes(v)) return true;

  if (['0', 'false', 'f', 'no', 'n', 'off', 'disable', 'disabled'].includes(v)) return false;

  return null;
}

function resolveFromUrl(url: string | undefined, keys: readonly string[]): OptionInput<'url'> | null {
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

function resolveFromEnv(env: BrowserEnvironment | undefined, keys: readonly string[]): OptionInput<'env'> | null {
  if (!env) return null;

  for (const k of keys) {
    const v = env[k];

    if (v === undefined) continue;

    const parsed = envValueSchema.safeParse(v);

    if (parsed.success) return { raw: parsed.data, source: 'env' };
  }

  return null;
}

function resolveFromLocalStorage(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  key: string | undefined,
): OptionInput<'localStorage'> | null {
  if (!storage || !key) return null;

  try {
    const v = storage.getItem(key);

    return v === null ? null : { raw: v, source: 'localStorage' };
  } catch {
    return null;
  }
}

function resolveBoolean(spec: BooleanSpec, ctx: VacpBrowserOptionContext): BooleanResolution {
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

function getDefaultEnvRecord(): BrowserEnvironment | undefined {
  const fromVite = envRecordSchema.safeParse(import.meta.env);

  if (fromVite.success) return fromVite.data;

  return typeof process === 'undefined' ? undefined : process.env;
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

export function resolveVacpBrowserOptions(ctx?: VacpBrowserOptionContext): VacpBrowserOptions {
  return resolveVacpBrowserOptionDetails(ctx).values;
}

export function resolveVacpBrowserOptionDetails(ctx: VacpBrowserOptionContext = {}): VacpBrowserOptionResolution {
  const resolveDetail = (key: VacpBrowserOptionKey): VacpBrowserOptionDetail => {
    const spec = BOOL_SPECS[key];
    const resolved = resolveBoolean(spec, ctx);

    return {
      ...resolved,
      raw: resolved.raw,
      default: spec.default,
      urlKeys: spec.urlKeys,
      envKeys: spec.envKeys,
      localStorageKey: spec.localStorageKey,
    };
  };

  const details = {
    inspector: resolveDetail('inspector'),
    exposeBridge: resolveDetail('exposeBridge'),
    domSnapshot: resolveDetail('domSnapshot'),
    enableSql: resolveDetail('enableSql'),
  };

  const values = {
    inspector: details.inspector.value,
    exposeBridge: details.exposeBridge.value,
    domSnapshot: details.domSnapshot.value,
    enableSql: details.enableSql.value,
  };

  return { values, details };
}

/**
 * Convenience wrapper for browser apps:
 * - reads URL from `window.location.href` (if present)
 * - reads env from `import.meta.env` (Vite) or `process.env` (Node/bundlers)
 * - reads storage from `localStorage` (if present)
 */
export function getVacpBrowserOptions(): VacpBrowserOptions {
  return getVacpBrowserOptionResolution().values;
}

export function getVacpBrowserOptionResolution(): VacpBrowserOptionResolution {
  return resolveVacpBrowserOptionDetails({
    url: getDefaultUrl(),
    env: getDefaultEnvRecord(),
    storage: getDefaultStorage(),
  });
}

export function setVacpBrowserOptionOverride(
  key: VacpBrowserOptionKey,
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

export function clearVacpBrowserOptionOverride(
  key: VacpBrowserOptionKey,
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
