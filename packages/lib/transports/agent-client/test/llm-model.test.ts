import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeVacpGeminiConfig } from '../src/create-gemini-model';
import { listVacpLLMModels, normalizeVacpLLMConfig } from '../src/create-llm-model';
import { normalizeVacpOpenAICompatibleConfig } from '../src/create-openai-compatible-model';

test('normalizeVacpLLMConfig infers provider from providerName when provider is missing', () => {
  const normalized = normalizeVacpLLMConfig({
    provider: undefined as unknown as 'gemini',
    providerName: 'google.generative-ai',
    baseURL: '',
    apiKey: 'key',
    model: 'gemini-2.5-flash',
  });

  assert.equal(normalized.provider, 'gemini');
  assert.equal(normalized.providerName, 'google.generative-ai');
});

test('normalizeVacpLLMConfig enforces baseURL for openai-compatible configs', () => {
  assert.throws(
    () =>
      normalizeVacpLLMConfig({
        provider: 'openai-compatible',
        providerName: 'openai-compatible',
        baseURL: '',
        apiKey: 'key',
        model: 'gpt-4o-mini',
      }),
    /Missing baseURL/i,
  );
});

test('normalizeVacpOpenAICompatibleConfig rejects non-openai provider configs', () => {
  assert.throws(
    () =>
      normalizeVacpOpenAICompatibleConfig({
        provider: 'gemini',
        providerName: 'google.generative-ai',
        baseURL: '',
        apiKey: 'key',
        model: 'gemini-2.5-flash',
      }),
    /Expected openai-compatible provider config/i,
  );
});

test('normalizeVacpGeminiConfig rejects non-gemini provider configs', () => {
  assert.throws(
    () =>
      normalizeVacpGeminiConfig({
        provider: 'openai-compatible',
        providerName: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'key',
        model: 'gpt-4o-mini',
      }),
    /Expected gemini provider config/i,
  );
});

test('normalizeVacpGeminiConfig trims optional baseURL and keeps empty optional URL valid', () => {
  const withUrl = normalizeVacpGeminiConfig({
    provider: 'gemini',
    providerName: 'google.generative-ai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/',
    apiKey: 'key',
    model: 'gemini-2.5-flash',
  });
  assert.equal(withUrl.baseURL, 'https://generativelanguage.googleapis.com/v1beta');

  const emptyUrl = normalizeVacpGeminiConfig({
    provider: 'gemini',
    providerName: 'google.generative-ai',
    baseURL: '',
    apiKey: 'key',
    model: 'gemini-2.5-flash',
  });
  assert.equal(emptyUrl.baseURL, '');
});

test('listVacpLLMModels uses OpenAI-compatible models endpoint and normalizes IDs', async () => {
  const calls: Array<{ input: unknown; init: unknown }> = [];
  const models = await listVacpLLMModels(
    {
      provider: 'openai-compatible',
      providerName: 'openai-compatible',
      baseURL: 'http://localhost:8317/v1/',
      apiKey: 'default',
      model: 'gpt-5.2',
    },
    {
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ data: [{ id: 'gpt-5.2' }, { id: 'gpt-4.1' }, { id: 'gpt-5.2' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );

  assert.equal(String(calls[0]?.input), 'http://localhost:8317/v1/models');
  const openAIHeaders = ((calls[0]?.init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
  assert.equal(openAIHeaders.Authorization, 'Bearer default');
  assert.deepEqual(
    models.map((model) => model.id),
    ['gpt-4.1', 'gpt-5.2'],
  );
});

test('listVacpLLMModels uses Gemini models endpoint and strips models/ prefix', async () => {
  const calls: Array<{ input: unknown; init: unknown }> = [];
  const models = await listVacpLLMModels(
    {
      provider: 'gemini',
      providerName: 'google.generative-ai',
      baseURL: '',
      apiKey: 'AIzaSy-test',
      model: 'gemini-2.5-flash',
    },
    {
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                supportedGenerationMethods: ['generateContent'],
              },
              {
                name: 'models/embedding-001',
                supportedGenerationMethods: ['embedContent'],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    },
  );

  assert.equal(String(calls[0]?.input), 'https://generativelanguage.googleapis.com/v1beta/models');
  const geminiHeaders = ((calls[0]?.init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>;
  assert.equal(geminiHeaders['x-goog-api-key'], 'AIzaSy-test');
  assert.deepEqual(
    models.map((model) => model.id),
    ['gemini-2.5-flash'],
  );
});
