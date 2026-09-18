import type { VacpLLMConfig, VacpLLMProvider } from './types';

const VACP_LLM_CONFIG_KEY = 'vacp:inspector:chat:llmConfig:v1';

type StoredVacpLLMConfigV2 = {
  version: 2;
  activeProvider: VacpLLMProvider;
  providerConfigs: Partial<Record<VacpLLMProvider, VacpLLMConfig>>;
};

function defaultProviderName(provider: VacpLLMProvider): string {
  return provider === 'gemini' ? 'google.generative-ai' : 'openai-compatible';
}

function defaultBaseUrl(provider: VacpLLMProvider): string {
  return provider === 'gemini' ? '' : 'https://api.openai.com/v1';
}

function defaultModel(provider: VacpLLMProvider): string {
  return provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-5.2';
}

export function defaultVacpLLMConfigForProvider(provider: VacpLLMProvider): VacpLLMConfig {
  return {
    provider,
    providerName: defaultProviderName(provider),
    baseURL: defaultBaseUrl(provider),
    apiKey: '',
    model: defaultModel(provider),
    temperature: 0.2,
    maxSteps: 10,
    maxOutputTokens: 900,
  };
}

function migrateConfig(value: unknown): VacpLLMConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as Record<string, unknown>;
  const providerName = typeof config.providerName === 'string' ? config.providerName : '';

  const provider =
    config.provider === 'gemini' || providerName.trim().toLowerCase().startsWith('google')
      ? 'gemini'
      : 'openai-compatible';

  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
  const model = typeof config.model === 'string' ? config.model : '';

  return {
    provider,
    providerName: providerName || (provider === 'gemini' ? 'google.generative-ai' : 'openai-compatible'),
    baseURL: typeof config.baseURL === 'string' ? config.baseURL : '',
    apiKey,
    model,
    temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
    maxSteps: typeof config.maxSteps === 'number' ? config.maxSteps : undefined,
    maxOutputTokens: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined,
  };
}

function normalizeProviderConfig(provider: VacpLLMProvider, config: VacpLLMConfig): VacpLLMConfig {
  return {
    provider,
    providerName: config.providerName || defaultProviderName(provider),
    baseURL: config.baseURL ?? defaultBaseUrl(provider),
    apiKey: config.apiKey ?? '',
    model: config.model || defaultModel(provider),
    temperature: config.temperature,
    maxSteps: config.maxSteps,
    maxOutputTokens: config.maxOutputTokens,
  };
}

function parseStored(raw: string): StoredVacpLLMConfigV2 | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      config?: unknown;
      activeProvider?: unknown;
      providerConfigs?: unknown;
    };

    if (!parsed || typeof parsed !== 'object') return null;

    if (parsed.version === 1) {
      const config = migrateConfig(parsed.config);

      if (!config) return null;

      return {
        version: 2,
        activeProvider: config.provider,
        providerConfigs: {
          [config.provider]: normalizeProviderConfig(config.provider, config),
        },
      };
    }

    if (parsed.version !== 2) return null;
    const activeProvider = parsed.activeProvider === 'gemini' ? 'gemini' : 'openai-compatible';

    const providerConfigsRaw =
      parsed.providerConfigs && typeof parsed.providerConfigs === 'object'
        ? (parsed.providerConfigs as Record<string, unknown>)
        : {};

    const providerConfigs: Partial<Record<VacpLLMProvider, VacpLLMConfig>> = {};

    for (const provider of ['openai-compatible', 'gemini'] as const) {
      const migrated = migrateConfig(providerConfigsRaw[provider]);

      if (!migrated) continue;
      providerConfigs[provider] = normalizeProviderConfig(provider, migrated);
    }

    return {
      version: 2,
      activeProvider,
      providerConfigs,
    };
  } catch {
    return null;
  }
}

export function loadVacpLLMActiveProvider(): VacpLLMProvider | null {
  try {
    const raw = localStorage.getItem(VACP_LLM_CONFIG_KEY);

    if (!raw) return null;

    return parseStored(raw)?.activeProvider ?? null;
  } catch {
    return null;
  }
}

export function loadVacpLLMConfig(provider?: VacpLLMProvider): VacpLLMConfig | null {
  try {
    const raw = localStorage.getItem(VACP_LLM_CONFIG_KEY);

    if (!raw) return null;
    const stored = parseStored(raw);

    if (!stored) return null;
    const resolvedProvider = provider ?? stored.activeProvider;

    return stored.providerConfigs[resolvedProvider] ?? null;
  } catch {
    return null;
  }
}

function loadStoredState(): StoredVacpLLMConfigV2 {
  try {
    const raw = localStorage.getItem(VACP_LLM_CONFIG_KEY);

    return raw
      ? (parseStored(raw) ?? { version: 2, activeProvider: 'openai-compatible', providerConfigs: {} })
      : {
          version: 2,
          activeProvider: 'openai-compatible',
          providerConfigs: {},
        };
  } catch {
    return {
      version: 2,
      activeProvider: 'openai-compatible',
      providerConfigs: {},
    };
  }
}

export function saveVacpLLMConfig(config: VacpLLMConfig) {
  const stored = loadStoredState();
  const provider = config.provider;

  const next: StoredVacpLLMConfigV2 = {
    version: 2,
    activeProvider: provider,
    providerConfigs: {
      ...stored.providerConfigs,
      [provider]: normalizeProviderConfig(provider, config),
    },
  };

  try {
    localStorage.setItem(VACP_LLM_CONFIG_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures in constrained environments
  }
}

export function saveVacpLLMActiveProvider(provider: VacpLLMProvider) {
  const stored = loadStoredState();

  const next: StoredVacpLLMConfigV2 = {
    ...stored,
    activeProvider: provider,
  };

  try {
    localStorage.setItem(VACP_LLM_CONFIG_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function clearVacpLLMConfig() {
  try {
    localStorage.removeItem(VACP_LLM_CONFIG_KEY);
  } catch {
    // ignore
  }
}

export const vacpLLMConfigStorageKey = VACP_LLM_CONFIG_KEY;
