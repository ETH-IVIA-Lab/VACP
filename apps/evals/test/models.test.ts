import assert from 'node:assert/strict';
import test from 'node:test';
import { generateText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { cacheWriteUsage, servedAs } from '../src/adapters/models';

test('cache writes a gateway reports in the response body reach usage', async () => {
  const model = wrapLanguageModel({
    model: new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: 'ok' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 5000, noCache: 5000, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined },
        },
        response: {
          body: {
            usage: { prompt_tokens: 5000, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 3109 } },
          },
        },
        warnings: [],
      },
    }),
    middleware: cacheWriteUsage,
  });
  const { usage } = await generateText({ model, prompt: 'Reply with OK.' });
  assert.equal(usage.inputTokenDetails.cacheWriteTokens, 3109);
  assert.equal(usage.inputTokenDetails.noCacheTokens, 1891);
});

test('the served model matches the requested one across snapshot and provider prefixes, and nothing else', () => {
  assert.equal(servedAs('claude-haiku-4-5', 'claude-haiku-4-5-20251001'), true);
  assert.equal(servedAs('gpt-6-luna', 'local/gpt-6-luna'), true);
  assert.equal(servedAs('claude-sonnet-5-5', 'claude-sonnet-5'), false);
  assert.equal(servedAs('gpt-6-luna', 'gpt-5.6-luna'), false);
});
