import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpLLMConfig } from '@vacp/agent-client';

import { sameChatScopeMeta } from '../src/overlay/modules/chat/chat-store';
import { createVacpChatSessionCacheKey } from '../src/overlay/modules/chat/chat-session-registry';

const CONFIG: VacpLLMConfig = {
  provider: 'openai-compatible',
  providerName: 'openai-compatible',
  baseURL: 'https://api.example.test/v1',
  apiKey: 'sk-old-secret',
  model: 'gpt-5.4',
  temperature: 0.2,
  maxSteps: 6,
  maxOutputTokens: 900,
};

function sessionKey(config: VacpLLMConfig, credentialRevision: number): string {
  return createVacpChatSessionCacheKey({
    scopeId: 'runtime:r1:url:http://example.test',
    threadId: 'thread:1',
    sessionRevision: 0,
    credentialRevision,
    runtimeId: 'r1',
    config,
  });
}

test('chat session cache key rotates on credential revision without storing API keys', () => {
  const oldKey = sessionKey(CONFIG, 0);
  const changedSecretSameRevision = sessionKey({ ...CONFIG, apiKey: 'sk-new-secret' }, 0);
  const changedSecretNewRevision = sessionKey({ ...CONFIG, apiKey: 'sk-new-secret' }, 1);

  assert.equal(changedSecretSameRevision, oldKey);
  assert.notEqual(changedSecretNewRevision, oldKey);
  assert.equal(oldKey.includes('sk-old-secret'), false);
  assert.equal(changedSecretNewRevision.includes('sk-new-secret'), false);
});

test('chat scope metadata ignores timestamp churn', () => {
  const base = {
    scopeId: 'runtime:r1:url:http://example.test',
    label: 'current view',
    runtimeId: 'r1',
    sessionKey: 'session-1',
    viewRef: 'vacp://view/main' as const,
    vizRef: 'vacp://view/main/viz' as const,
    urlKey: 'http://example.test',
    updatedAt: '2026-06-10T10:00:00.000Z',
  };

  assert.equal(
    sameChatScopeMeta(base, {
      ...base,
      updatedAt: '2026-06-10T10:00:01.000Z',
    }),
    true,
  );
  assert.equal(
    sameChatScopeMeta(base, {
      ...base,
      vizRef: 'vacp://view/main/other-viz',
    }),
    false,
  );
});
