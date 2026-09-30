import { createGoogle } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

import type { VacpLLMConfig, VacpLLMModelListOptions, VacpLLMModelOption } from './types';

const GEMINI_PROVIDER = 'gemini';

const DEFAULT_GEMINI_PROVIDER_NAME = 'google.generative-ai';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function required(value: string, label: string): string {
  const trimmed = value.trim();

  if (!trimmed) throw new Error(`Missing ${label}`);

  return trimmed;
}

function normalizeOptionalBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim();

  if (!trimmed) return '';

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function normalizeVacpGeminiConfig(config: VacpLLMConfig): VacpLLMConfig {
  if (config.provider !== GEMINI_PROVIDER) {
    throw new Error(`Expected ${GEMINI_PROVIDER} provider config`);
  }

  return {
    ...config,
    provider: GEMINI_PROVIDER,
    providerName: required(config.providerName || DEFAULT_GEMINI_PROVIDER_NAME, 'provider name'),
    baseURL: normalizeOptionalBaseUrl(config.baseURL ?? ''),
    apiKey: required(config.apiKey, 'API key'),
    model: required(config.model, 'model'),
  };
}

export function createVacpGeminiModel(config: VacpLLMConfig): LanguageModel {
  const normalized = normalizeVacpGeminiConfig(config);

  const provider = createGoogle({
    name: normalized.providerName,
    apiKey: normalized.apiKey,
    ...(normalized.baseURL ? { baseURL: normalized.baseURL } : {}),
  });

  return provider(normalized.model);
}

function parseGeminiModelOptions(raw: unknown): VacpLLMModelOption[] {
  if (!raw || typeof raw !== 'object' || !('models' in raw)) return [];
  const models = raw.models;

  if (!Array.isArray(models)) return [];

  const byId = new Map<string, VacpLLMModelOption>();

  for (const item of models) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as { name?: unknown }).name;

    if (typeof name !== 'string') continue;
    const supportedGenerationMethods = (item as { supportedGenerationMethods?: unknown }).supportedGenerationMethods;

    if (
      Array.isArray(supportedGenerationMethods) &&
      !supportedGenerationMethods.some((method) => method === 'generateContent' || method === 'streamGenerateContent')
    ) {
      continue;
    }

    const id = name.startsWith('models/') ? name.slice('models/'.length) : name;
    const trimmed = id.trim();

    if (!trimmed) continue;
    const displayName = (item as { displayName?: unknown }).displayName;
    const description = (item as { description?: unknown }).description;
    byId.set(trimmed, {
      id: trimmed,
      label: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : trimmed,
      ...(typeof description === 'string' && description.trim() ? { description: description.trim() } : {}),
    });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function listVacpGeminiModels(
  config: VacpLLMConfig,
  options: VacpLLMModelListOptions = {},
): Promise<VacpLLMModelOption[]> {
  const normalized = normalizeVacpGeminiConfig(config);
  const fetcher = options.fetcher ?? fetch;
  const baseURL = normalized.baseURL || DEFAULT_GEMINI_BASE_URL;

  const response = await fetcher(`${baseURL}/models`, {
    method: 'GET',
    headers: { 'x-goog-api-key': normalized.apiKey },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Unable to list models (${response.status})`);
  }

  return parseGeminiModelOptions(await response.json());
}
