import type { LanguageModel } from 'ai';

import { createVacpGeminiModel, listVacpGeminiModels, normalizeVacpGeminiConfig } from './create-gemini-model';
import {
  createVacpOpenAICompatibleModel,
  listVacpOpenAICompatibleModels,
  normalizeVacpOpenAICompatibleConfig,
} from './create-openai-compatible-model';
import type { VacpLLMConfig, VacpLLMModelListOptions, VacpLLMModelOption, VacpLLMProvider } from './types';

const OPENAI_COMPATIBLE_PROVIDER: VacpLLMProvider = 'openai-compatible';
const GEMINI_PROVIDER: VacpLLMProvider = 'gemini';
const DEFAULT_OPENAI_COMPATIBLE_PROVIDER_NAME = 'openai-compatible';
const DEFAULT_GEMINI_PROVIDER_NAME = 'google.generative-ai';

const providerNormalizers: Record<VacpLLMProvider, (config: VacpLLMConfig) => VacpLLMConfig> = {
  [OPENAI_COMPATIBLE_PROVIDER]: normalizeVacpOpenAICompatibleConfig,
  [GEMINI_PROVIDER]: normalizeVacpGeminiConfig,
};

const providerModelFactories: Record<VacpLLMProvider, (config: VacpLLMConfig) => LanguageModel> = {
  [OPENAI_COMPATIBLE_PROVIDER]: createVacpOpenAICompatibleModel,
  [GEMINI_PROVIDER]: createVacpGeminiModel,
};

const providerModelListers: Record<
  VacpLLMProvider,
  (config: VacpLLMConfig, options?: VacpLLMModelListOptions) => Promise<VacpLLMModelOption[]>
> = {
  [OPENAI_COMPATIBLE_PROVIDER]: listVacpOpenAICompatibleModels,
  [GEMINI_PROVIDER]: listVacpGeminiModels,
};

function resolveProvider(config: VacpLLMConfig): VacpLLMProvider {
  if (config.provider === OPENAI_COMPATIBLE_PROVIDER || config.provider === GEMINI_PROVIDER) {
    return config.provider;
  }
  const providerName = (config.providerName ?? '').trim().toLowerCase();
  if (providerName === GEMINI_PROVIDER || providerName.startsWith('google')) return GEMINI_PROVIDER;
  return OPENAI_COMPATIBLE_PROVIDER;
}

export function normalizeVacpLLMConfig(config: VacpLLMConfig): VacpLLMConfig {
  const provider = resolveProvider(config);
  const hydrated: VacpLLMConfig = {
    ...config,
    provider,
    providerName:
      config.providerName ||
      (provider === OPENAI_COMPATIBLE_PROVIDER
        ? DEFAULT_OPENAI_COMPATIBLE_PROVIDER_NAME
        : DEFAULT_GEMINI_PROVIDER_NAME),
    baseURL: config.baseURL ?? '',
  };
  return providerNormalizers[provider](hydrated);
}

export function createVacpLLMModel(config: VacpLLMConfig): LanguageModel {
  const normalized = normalizeVacpLLMConfig(config);
  return providerModelFactories[normalized.provider](normalized);
}

export async function listVacpLLMModels(
  config: VacpLLMConfig,
  options: VacpLLMModelListOptions = {},
): Promise<VacpLLMModelOption[]> {
  const normalized = normalizeVacpLLMConfig(config);
  return providerModelListers[normalized.provider](normalized, options);
}
