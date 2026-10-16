import { HarnessAgent, type HarnessAgentAdapter } from '@ai-sdk/harness/agent';
import { createClaudeCode, type ClaudeCodeHarnessSettings } from '@ai-sdk/harness-claude-code';
import { createCodex, type CodexHarnessSettings } from '@ai-sdk/harness-codex';
import { createOpenCode, type OpenCodeHarnessSettings } from '@ai-sdk/harness-opencode';
import { createPi, type PiHarnessSettings } from '@ai-sdk/harness-pi';
import { createVacpAgentTools } from '@vacp/agent-ai-sdk';
import { vacpAgentActor, vacpAgentTools } from '@vacp/protocol';
import { createVacpTransport } from '@vacp/transport-bridge';
import { isStepCount, type TelemetryOptions, type ToolSet } from 'ai';
import { join } from 'node:path';

import type { Condition, ResolvedModel } from '../ports';
import { browserAssistantInstructions } from './instructions';
import { LocalSandbox } from './local-sandbox';

type Endpoint = { baseURL: string; apiKey: string };

/** The model's OpenAI-compatible endpoint, which every harness condition reaches in its runtime's protocol. */
function endpoint(model: ResolvedModel): Endpoint {
  const { baseURL, apiKey } = model.provider;
  if (!baseURL || !apiKey)
    throw new Error(
      `Harness conditions need a provider with a base URL and key, and ${model.key} uses ${model.provider.key}`,
    );
  return { baseURL: baseURL.replace(/\/+$/, ''), apiKey };
}

export type HarnessConditionOptions = {
  /** The adapter's name, which the condition's description records. */
  runtime: string;
  /** The runtime's adapter, configured to reach the flow's model through the runtime's own protocol. */
  harness(input: { model: ResolvedModel; workspace: string }): HarnessAgentAdapter;
  /** The model id the runtime is given. Defaults to the model's id. */
  modelId?(model: ResolvedModel): string;
  /**
   * Allow only the VACP tools. Set it to false for adapters that cannot filter their built-in tools,
   * which then stay available beside the VACP tools.
   */
  vacpToolsOnly: boolean;
  instructions?: string;
  settings?: Record<string, unknown>;
};

/**
 * An agent runtime driven through AI SDK's `HarnessAgent`, reaching the page through the VACP agent
 * tools the MCP server also offers: `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_execute`,
 * and `vacp_progress`, executed in this process against the page. Their names and schemas stay fixed
 * within a turn, as `HarnessAgent` requires. Each conversation gets its own `LocalSandbox`.
 */
export function harnessCondition(options: HarnessConditionOptions): Condition {
  const instructions = options.instructions ?? browserAssistantInstructions;
  const tools = Object.keys(vacpAgentTools).join(', ');
  return {
    kind: 'agent',
    async start({ model, signal, workspace }) {
      const harness = options.harness({ model, workspace });
      const sandboxes = join(workspace, 'sandboxes');
      const agentFor = (tools: ToolSet, maxSteps: number, telemetry?: TelemetryOptions) =>
        new HarnessAgent({
          harness,
          model: options.modelId?.(model) ?? model.id,
          instructions,
          tools,
          ...(options.vacpToolsOnly ? { activeTools: Object.keys(tools) } : {}),
          stopWhen: isStepCount(maxSteps),
          telemetry,
        });
      // Install the runtime once, before conversations run in parallel against the shared HOME.
      const template = await agentFor({}, 1).getSandboxTemplate();
      if (template) {
        const sandbox = await LocalSandbox.create(sandboxes);
        try {
          await template.prepare({ session: sandbox.restricted(), abortSignal: signal });
        } finally {
          await sandbox.destroy();
        }
      }
      return {
        description: {
          loop: `@ai-sdk/harness HarnessAgent, ${options.runtime} adapter, in a local sandbox`,
          instructions,
          tools: options.vacpToolsOnly ? tools : `${tools}, beside the runtime's built-in tools`,
          settings: options.settings,
        },
        async conversation({ page, signal: runSignal, maxSteps, telemetry }) {
          const vacp = createVacpAgentTools(createVacpTransport(page.bridge));
          // HarnessAgent reports telemetry only when it is configured, unlike registered AI SDK calls.
          const agent = agentFor(vacp, maxSteps, telemetry());
          const sandbox = await LocalSandbox.create(sandboxes);
          const session = await agent.createSession({ sandboxSession: sandbox });
          return {
            async say(message) {
              // One request is one turn: the model's sentences and steps join it, and its outcome closes it.
              const turn = page.bridge.beginAgentActivity({ actor: vacpAgentActor });
              let outcome: 'completed' | 'failed' | 'cancelled' = 'failed';
              try {
                const result = await agent.generate({ session, prompt: message, abortSignal: runSignal });
                outcome = 'completed';
                if (result.finishReason === 'length') return { text: result.text, stop: 'length' };
                if (!session.hasUnfinishedTurn()) return { text: result.text, stop: 'done' };
                // The step budget ended the turn early. Parking it lets the next turn start fresh.
                await session.suspendTurn();
                return { text: result.text, stop: 'max-steps' };
              } catch (error) {
                if (runSignal.aborted) outcome = 'cancelled';
                throw error;
              } finally {
                turn.end({ outcome });
              }
            },
            async close() {
              await session.destroy();
              await sandbox.destroy();
            },
          };
        },
      };
    },
  };
}

/** Claude Code speaks Anthropic Messages, served at the endpoint's origin: `<origin>/v1/messages`. */
export function claudeCodeCondition(settings: Pick<ClaudeCodeHarnessSettings, 'effort' | 'thinking'> = {}) {
  return harnessCondition({
    runtime: 'claude-code',
    vacpToolsOnly: true,
    settings,
    harness: ({ model }) => {
      const { baseURL, apiKey } = endpoint(model);
      return createClaudeCode({
        ...settings,
        auth: { ANTHROPIC_BASE_URL: baseURL.replace(/\/v1$/, ''), ANTHROPIC_API_KEY: apiKey },
      });
    },
  });
}

/**
 * Codex speaks the OpenAI Responses API at the endpoint. Its adapter cannot filter built-in tools, so
 * Codex keeps its shell and patch tools, which run as the current user from the sandbox's directory.
 */
export function codexCondition(settings: Pick<CodexHarnessSettings, 'reasoningEffort'> = {}) {
  return harnessCondition({
    runtime: 'codex',
    vacpToolsOnly: false,
    settings,
    harness: ({ model }) => {
      const { baseURL, apiKey } = endpoint(model);
      return createCodex({
        ...settings,
        auth: { OPENAI_BASE_URL: baseURL, OPENAI_API_KEY: apiKey },
        // Codex ships metadata for OpenAI's own models only, and plans compaction from this window.
        codexConfig: { model_context_window: model.contextWindow ?? 200_000 },
      });
    },
  });
}

/** OpenCode reaches the endpoint through its `openai` provider. */
export function openCodeCondition(settings: Pick<OpenCodeHarnessSettings, 'reasoningVariant'> = {}) {
  return harnessCondition({
    runtime: 'opencode',
    vacpToolsOnly: true,
    settings,
    harness: ({ model }) => {
      const { baseURL, apiKey } = endpoint(model);
      return createOpenCode({
        ...settings,
        auth: { OPENAI_BASE_URL: baseURL, OPENAI_API_KEY: apiKey },
        provider: 'openai',
      });
    },
  });
}

/**
 * Pi runs in this process and reaches the endpoint as a registered `eval` provider over chat
 * completions. Its agent directory is the condition's own, so Pi reads no settings from the user's.
 */
export function piCondition(settings: Pick<PiHarnessSettings, 'thinkingLevel'> = {}) {
  return harnessCondition({
    runtime: 'pi',
    vacpToolsOnly: true,
    settings,
    modelId: (model) => `eval/${model.id}`,
    harness: ({ model, workspace }) => {
      const { baseURL, apiKey } = endpoint(model);
      return createPi({
        ...settings,
        agentDir: join(workspace, 'agent'),
        auth: { EVAL_API_KEY: apiKey, EVAL_BASE_URL: baseURL },
        providers: {
          eval: {
            api: 'openai-completions',
            baseUrl: baseURL,
            apiKey: 'EVAL_API_KEY',
            models: [
              {
                id: model.id,
                name: model.id,
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: model.contextWindow ?? 200_000,
                maxTokens: 32_000,
              },
            ],
          },
        },
      });
    },
  });
}
