import { withAgentActivity } from './activity-transport';
import { createAgentTurns } from './agent-turn';
import { DirectChatTransport, ToolLoopAgent, stepCountIs } from 'ai';
import type { LanguageModelUsage } from 'ai';

import { createVacpLLMModel, normalizeVacpLLMConfig } from './create-llm-model';
import { wrapTransportWithVacpContextCompaction } from './context-compaction';
import { buildVacpAgentInstructions } from './instructions';
import type { VacpAgentFactoryOptions, VacpChatMessageMetadata, VacpTokenUsage } from './types';
import { createVacpProgressTool, createVacpTools } from './vacp-tools';

const DEFAULT_MAX_STEPS = 8;

const DEFAULT_TEMPERATURE = 0.2;

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(raw: LanguageModelUsage | undefined): VacpTokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const value = raw;

  const usage: VacpTokenUsage = {
    inputTokens: asFiniteNumber(value.inputTokens),
    outputTokens: asFiniteNumber(value.outputTokens),
    totalTokens: asFiniteNumber(value.totalTokens),
    reasoningTokens: asFiniteNumber(value.outputTokenDetails?.reasoningTokens) ?? asFiniteNumber(value.reasoningTokens),
    textTokens: asFiniteNumber(value.outputTokenDetails?.textTokens),
    cacheReadTokens: asFiniteNumber(value.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: asFiniteNumber(value.inputTokenDetails?.cacheWriteTokens),
    noCacheTokens: asFiniteNumber(value.inputTokenDetails?.noCacheTokens),
  };

  return Object.values(usage).some((item) => item != null) ? usage : undefined;
}

function createVacpMessageMetadata(options: VacpAgentFactoryOptions) {
  const config = normalizeVacpLLMConfig(options.config);

  return ({
    part,
  }: {
    part: { type: string; usage?: LanguageModelUsage; totalUsage?: LanguageModelUsage };
  }): VacpChatMessageMetadata | undefined => {
    if (part.type === 'finish-step') {
      const stepUsage = normalizeUsage(part.usage);

      if (!stepUsage) return undefined;

      return { provider: config.provider, providerName: config.providerName, model: config.model, stepUsage };
    }

    if (part.type === 'finish') {
      const totalUsage = normalizeUsage(part.totalUsage);

      return {
        provider: config.provider,
        providerName: config.providerName,
        model: config.model,
        finishedAt: new Date().toISOString(),
        ...(totalUsage ? { totalUsage } : {}),
      };
    }

    return undefined;
  };
}

function createAgent(options: VacpAgentFactoryOptions) {
  const config = normalizeVacpLLMConfig(options.config);
  // Steps and turns share one actor, so each step joins the turn that narrates it.
  const actor = options.actor ?? { id: 'agent', kind: 'agent', label: 'Assistant' };
  const turns = options.activity ? createAgentTurns(options.activity, actor) : undefined;
  const tools = {
    ...createVacpTools({ transport: options.transport, onToolEvent: options.onToolEvent, actor }),
    ...(turns ? createVacpProgressTool(turns.progress) : {}),
  };

  const instructions = buildVacpAgentInstructions({
    baseInstructions: options.instructions,
    interactionPolicy: options.interactionPolicy,
  });

  const agent = new ToolLoopAgent({
    model: createVacpLLMModel(config),
    instructions,
    stopWhen: stepCountIs(config.maxSteps ?? DEFAULT_MAX_STEPS),
    temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    maxOutputTokens: config.maxOutputTokens,
    tools,
    // A turn the model opened through vacp_progress closes with the agent run, chat transport or not.
    onFinish: () => turns?.end(),
  });
  return { agent, turns };
}

export function createVacpToolLoopAgent(options: VacpAgentFactoryOptions) {
  return createAgent(options).agent;
}

export function createVacpChatRuntime(options: VacpAgentFactoryOptions) {
  const { agent, turns } = createAgent(options);
  const baseTransport = new DirectChatTransport({ agent, messageMetadata: createVacpMessageMetadata(options) });

  const transport = wrapTransportWithVacpContextCompaction(baseTransport, options.contextCompactionPolicy, {
    availableToolNames: Object.keys(agent.tools),
  });

  return { agent, transport: turns ? withAgentActivity(transport, turns) : transport };
}
