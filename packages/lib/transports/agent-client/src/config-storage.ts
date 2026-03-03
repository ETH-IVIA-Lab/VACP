import type { VacpLLMConfig } from './types';

const VACP_LLM_CONFIG_KEY = 'vacp:debug:chat:llmConfig:v1';

type StoredVacpLLMConfig = {
  version: 1;
  config: VacpLLMConfig;
};

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

function parseStored(raw: string): StoredVacpLLMConfig | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; config?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;
    const config = migrateConfig(parsed.config);
    if (!config) return null;
    return { version: 1, config };
  } catch {
    return null;
  }
}

export function loadVacpLLMConfig(): VacpLLMConfig | null {
  try {
    const raw = localStorage.getItem(VACP_LLM_CONFIG_KEY);
    if (!raw) return null;
    return parseStored(raw)?.config ?? null;
  } catch {
    return null;
  }
}

export function saveVacpLLMConfig(config: VacpLLMConfig) {
  const stored: StoredVacpLLMConfig = { version: 1, config };
  try {
    localStorage.setItem(VACP_LLM_CONFIG_KEY, JSON.stringify(stored));
  } catch {
    // ignore storage failures in constrained environments
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
