import { existsSync } from 'node:fs';
import {
  claudeCodeCondition,
  codexCondition,
  controlCondition,
  defineSuite,
  openCodeCondition,
  oracleCondition,
  piCondition,
  vacpAgentCondition,
  webmcpCondition,
  type ModelConfig,
} from './src';
import scenarios from './scenarios';

const envFile = new URL('.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

/** Prices are first-party list prices in USD per million tokens. */
const models: Record<string, ModelConfig> = {
  'gpt-6-luna': { provider: 'local', id: 'gpt-6-luna' },
  'claude-sonnet-5-5': {
    provider: 'local',
    id: 'claude-sonnet-5-5',
    price: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  },
  'claude-opus-5-5': {
    provider: 'local',
    id: 'claude-opus-5-5',
    price: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  },
  'claude-haiku-4-5': {
    provider: 'local',
    id: 'claude-haiku-4-5-20251001',
    price: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  },
};
// `OPENAI_MODEL` picks the default. A model the list lacks is served by the local endpoint, unpriced.
const defaultModel = env.OPENAI_MODEL ?? 'gpt-6-luna';

/**
 * The suite: where models come from, the conditions under test, and the scenarios. A flow is one
 * condition on one model, so adding either is a line here and `--condition` or `--model` on the
 * command line. Every condition reaches its model through the provider's endpoint.
 */
export default defineSuite({
  providers: {
    local: {
      kind: 'openai-compatible',
      baseURL: env.OPENAI_BASE_URL ?? 'http://localhost:8317/v1',
      apiKey: env.OPENAI_API_KEY ?? 'default',
    },
  },
  models: defaultModel in models ? models : { ...models, [defaultModel]: { provider: 'local', id: defaultModel } },
  defaultModel,
  conditions: {
    webmcp: webmcpCondition(),
    'vacp-agent': vacpAgentCondition(),
    'claude-code': claudeCodeCondition(),
    codex: codexCondition(),
    opencode: openCodeCondition(),
    pi: piCondition(),
    oracle: oracleCondition(),
    none: controlCondition(),
  },
  defaultCondition: 'webmcp',
  scenarios,
});
