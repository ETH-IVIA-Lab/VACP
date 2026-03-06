import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearVacpLLMConfig,
  defaultVacpLLMConfigForProvider,
  loadVacpLLMActiveProvider,
  loadVacpLLMConfig,
  saveVacpLLMActiveProvider,
  saveVacpLLMConfig,
  vacpLLMConfigStorageKey,
} from '../src/config-storage';
import type { VacpLLMConfig } from '../src/types';

class LocalStorageMock {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

const originalLocalStorage = globalThis.localStorage;

function setMockStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new LocalStorageMock(),
  });
}

function restoreStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
}

test.beforeEach(() => {
  setMockStorage();
});

test.afterEach(() => {
  restoreStorage();
});

test('saveVacpLLMConfig persists the active provider config without overwriting other provider slots', () => {
  const openai: VacpLLMConfig = {
    ...defaultVacpLLMConfigForProvider('openai-compatible'),
    baseURL: 'http://localhost:8317/v1',
    apiKey: 'default',
    model: 'gpt-5.4',
  };
  const gemini: VacpLLMConfig = {
    ...defaultVacpLLMConfigForProvider('gemini'),
    apiKey: 'gem-key',
    model: 'gemini-2.5-pro',
  };

  saveVacpLLMConfig(openai);
  saveVacpLLMConfig(gemini);

  assert.deepEqual(loadVacpLLMConfig('openai-compatible'), openai);
  assert.deepEqual(loadVacpLLMConfig('gemini'), gemini);
  assert.equal(loadVacpLLMActiveProvider(), 'gemini');
});

test('loadVacpLLMConfig migrates the legacy single-provider payload into the matching provider slot', () => {
  const legacy = {
    version: 1,
    config: {
      provider: 'openai-compatible',
      providerName: 'openai-compatible',
      baseURL: 'http://localhost:8317/v1',
      apiKey: 'default',
      model: 'gpt-5.4',
      temperature: 0.3,
      maxSteps: 12,
      maxOutputTokens: 1200,
    },
  };

  globalThis.localStorage.setItem(vacpLLMConfigStorageKey, JSON.stringify(legacy));

  assert.equal(loadVacpLLMActiveProvider(), 'openai-compatible');
  assert.deepEqual(loadVacpLLMConfig('openai-compatible'), legacy.config);
  assert.equal(loadVacpLLMConfig('gemini'), null);
});

test('saveVacpLLMActiveProvider updates the active provider without creating a leaked config', () => {
  saveVacpLLMConfig({
    ...defaultVacpLLMConfigForProvider('openai-compatible'),
    apiKey: 'default',
    baseURL: 'http://localhost:8317/v1',
  });

  saveVacpLLMActiveProvider('gemini');

  assert.equal(loadVacpLLMActiveProvider(), 'gemini');
  assert.equal(loadVacpLLMConfig('gemini'), null);
});

test('clearVacpLLMConfig removes every stored provider config', () => {
  saveVacpLLMConfig({
    ...defaultVacpLLMConfigForProvider('openai-compatible'),
    apiKey: 'default',
  });
  saveVacpLLMConfig({
    ...defaultVacpLLMConfigForProvider('gemini'),
    apiKey: 'gem-key',
  });

  clearVacpLLMConfig();

  assert.equal(loadVacpLLMActiveProvider(), null);
  assert.equal(loadVacpLLMConfig('openai-compatible'), null);
  assert.equal(loadVacpLLMConfig('gemini'), null);
});
