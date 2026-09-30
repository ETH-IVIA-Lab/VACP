import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createProviderRegistry, type LanguageModelMiddleware } from 'ai';

import type { ModelConfig, ProviderConfig, ResolvedModel } from '../ports';

/**
 * OpenAI-compatible gateways report prompt-cache writes in `usage.prompt_tokens_details`, which the
 * provider does not map. Cache writes bill above base input, so the eval reads them from the body.
 */
export const cacheWriteUsage: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    const details = (
      result.response?.body as { usage?: { prompt_tokens_details?: Record<string, unknown> } } | undefined
    )?.usage?.prompt_tokens_details;
    const written = details?.cache_write_tokens ?? details?.cache_creation_tokens ?? details?.cached_creation_tokens;
    if (typeof written !== 'number' || written <= 0 || result.usage.inputTokens.cacheWrite) return result;
    const { total, cacheRead } = result.usage.inputTokens;
    return {
      ...result,
      usage: {
        ...result.usage,
        inputTokens: {
          ...result.usage.inputTokens,
          cacheWrite: written,
          noCache: total === undefined ? undefined : Math.max(0, total - (cacheRead ?? 0) - written),
        },
      },
    };
  },
};

function provider(key: string, config: ProviderConfig) {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAICompatible({ name: key, baseURL: config.baseURL, apiKey: config.apiKey });
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }
}

/** Resolve models through one AI SDK provider registry, so every condition calls models the same way. */
export function createModels(
  providers: Readonly<Record<string, ProviderConfig>>,
  models: Readonly<Record<string, ModelConfig>>,
) {
  const registry = createProviderRegistry(
    Object.fromEntries(Object.entries(providers).map(([key, config]) => [key, provider(key, config)])),
    { languageModelMiddleware: cacheWriteUsage },
  );
  return (key: string): ResolvedModel => {
    const model = models[key];
    if (!model) throw new Error(`Unknown model "${key}". Configured: ${Object.keys(models).join(', ')}`);
    const config = providers[model.provider];
    if (!config) throw new Error(`Model "${key}" names unknown provider "${model.provider}"`);
    const { provider, ...settings } = model;
    return {
      ...settings,
      key,
      provider: { key: provider, ...config },
      language: registry.languageModel(`${provider}:${model.id}` as never),
    };
  };
}

/**
 * The served model is the requested one, allowing documented alias-to-snapshot resolution:
 * `claude-haiku-4-5` may come back as `claude-haiku-4-5-20251001`.
 */
export function servedAs(requested: string, served: string): boolean {
  const strip = (id: string) =>
    id.replace(/^(models\/|[a-z-]+\/)/, '').replace(/[-@](latest|\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  return served === requested || strip(served) === strip(requested);
}
