import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

import type { VacpLLMConfig, VacpLLMModelListOptions, VacpLLMModelOption } from './types';

const OPENAI_COMPATIBLE_PROVIDER = 'openai-compatible';

const DEFAULT_OPENAI_COMPATIBLE_PROVIDER_NAME = 'openai-compatible';

function required(value: string, label: string): string {
  const trimmed = value.trim();

  if (!trimmed) throw new Error(`Missing ${label}`);

  return trimmed;
}

function normalizeBaseUrl(baseURL: string): string {
  const trimmed = required(baseURL, 'baseURL');

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function normalizeVacpOpenAICompatibleConfig(config: VacpLLMConfig): VacpLLMConfig {
  if (config.provider !== OPENAI_COMPATIBLE_PROVIDER) {
    throw new Error(`Expected ${OPENAI_COMPATIBLE_PROVIDER} provider config`);
  }

  return {
    ...config,
    provider: OPENAI_COMPATIBLE_PROVIDER,
    providerName: required(config.providerName || DEFAULT_OPENAI_COMPATIBLE_PROVIDER_NAME, 'provider name'),
    baseURL: normalizeBaseUrl(config.baseURL ?? ''),
    apiKey: required(config.apiKey, 'API key'),
    model: required(config.model, 'model'),
  };
}

export function createVacpOpenAICompatibleModel(config: VacpLLMConfig): LanguageModel {
  const normalized = normalizeVacpOpenAICompatibleConfig(config);

  const provider = createOpenAICompatible({
    name: normalized.providerName,
    baseURL: normalized.baseURL,
    apiKey: normalized.apiKey,
  });

  return provider.chatModel(normalized.model);
}

function parseOpenAICompatibleModelOptions(raw: unknown): VacpLLMModelOption[] {
  if (!raw || typeof raw !== 'object' || !('data' in raw)) return [];
  const data = raw.data;

  if (!Array.isArray(data)) return [];

  const byId = new Map<string, VacpLLMModelOption>();

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;

    if (typeof id !== 'string') continue;
    const trimmed = id.trim();

    if (!trimmed) continue;
    byId.set(trimmed, { id: trimmed, label: trimmed });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function listVacpOpenAICompatibleModels(
  config: VacpLLMConfig,
  options: VacpLLMModelListOptions = {},
): Promise<VacpLLMModelOption[]> {
  const normalized = normalizeVacpOpenAICompatibleConfig(config);
  const fetcher = options.fetcher ?? fetch;

  const response = await fetcher(`${normalized.baseURL}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${normalized.apiKey}` },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Unable to list models (${response.status})`);
  }

  return parseOpenAICompatibleModelOptions(await response.json());
}
