import {
  DirectChatTransport,
  ToolLoopAgent,
  isStepCount,
  type ChatTransport,
  type LanguageModel,
  type LanguageModelUsage,
  type StreamTextTransform,
} from 'ai';
import { vacpAgentActor } from '@ethivia/vacp-protocol';

import { createActivityRequests, withAgentActivity } from './activity-transport';
import { wrapTransportWithVacpContextCompaction } from './context-compaction';
import { defaultVacpAgentInstructions } from './instructions';
import type {
  VacpAgentOptions,
  VacpChatMessage,
  VacpChatMessageMetadata,
  VacpChatRuntimeOptions,
  VacpTokenUsage,
} from './types';
import { createVacpAgentTools, type VacpAgentTools } from './vacp-tools';

/** The loop settings an agent uses when the host leaves them unset. */
export const vacpAgentDefaults = { maxSteps: 8, temperature: 0.2 } as const;

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(raw: LanguageModelUsage | undefined): VacpTokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const usage: VacpTokenUsage = {
    inputTokens: asFiniteNumber(raw.inputTokens),
    outputTokens: asFiniteNumber(raw.outputTokens),
    totalTokens: asFiniteNumber(raw.totalTokens),
    reasoningTokens: asFiniteNumber(raw.outputTokenDetails?.reasoningTokens),
    textTokens: asFiniteNumber(raw.outputTokenDetails?.textTokens),
    cacheReadTokens: asFiniteNumber(raw.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: asFiniteNumber(raw.inputTokenDetails?.cacheWriteTokens),
    noCacheTokens: asFiniteNumber(raw.inputTokenDetails?.noCacheTokens),
  };

  return Object.values(usage).some((item) => item != null) ? usage : undefined;
}

function modelIdentity(model: LanguageModel): Pick<VacpChatMessageMetadata, 'provider' | 'model'> {
  return typeof model === 'string' ? { model } : { provider: model.provider, model: model.modelId };
}

function createVacpMessageMetadata(model: LanguageModel) {
  const identity = modelIdentity(model);
  return ({
    part,
  }: {
    part: { type: string; usage?: LanguageModelUsage; totalUsage?: LanguageModelUsage };
  }): VacpChatMessageMetadata | undefined => {
    if (part.type === 'finish-step') {
      const stepUsage = normalizeUsage(part.usage);
      return stepUsage ? { ...identity, stepUsage } : undefined;
    }

    if (part.type === 'finish') {
      const totalUsage = normalizeUsage(part.totalUsage);
      return { ...identity, finishedAt: new Date().toISOString(), ...(totalUsage ? { totalUsage } : {}) };
    }

    return undefined;
  };
}

/** An AI SDK `ToolLoopAgent` over the five VACP tools. */
export function createVacpToolLoopAgent(options: VacpAgentOptions): ToolLoopAgent<never, VacpAgentTools> {
  const agent = new ToolLoopAgent({
    model: options.model,
    instructions: options.instructions ?? defaultVacpAgentInstructions,
    stopWhen: isStepCount(options.maxSteps ?? vacpAgentDefaults.maxSteps),
    temperature: options.temperature ?? vacpAgentDefaults.temperature,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: options.maxRetries,
    providerOptions: options.providerOptions,
    tools: createVacpAgentTools(options.transport),
    telemetry: options.telemetry,
  });
  if (!options.activity) return agent;
  const begin = createActivityRequests(options.activity.control, options.activity.actor ?? vacpAgentActor);
  const generate = agent.generate.bind(agent);
  agent.generate = async (request) => {
    const end = begin(request.abortSignal);
    try {
      const result = await generate(request);
      end('completed');
      return result;
    } catch (error) {
      end(request.abortSignal?.aborted ? 'cancelled' : 'failed');
      throw error;
    }
  };
  const stream = agent.stream.bind(agent);
  agent.stream = async (request) => {
    const end = begin(request.abortSignal);
    const observe: StreamTextTransform<VacpAgentTools> = () =>
      new TransformStream({
        transform(part, controller) {
          if (part.type === 'error') end(request.abortSignal?.aborted ? 'cancelled' : 'failed');
          else if (part.type === 'abort') end('cancelled');
          controller.enqueue(part);
        },
        flush() {
          end(request.abortSignal?.aborted ? 'cancelled' : 'completed');
        },
      });
    const transforms = request.experimental_transform;
    try {
      return await stream({
        ...request,
        experimental_transform: [observe, ...(Array.isArray(transforms) ? transforms : transforms ? [transforms] : [])],
      });
    } catch (error) {
      end(request.abortSignal?.aborted ? 'cancelled' : 'failed');
      throw error;
    }
  };
  return agent;
}

/** The same agent with an AI SDK chat transport for `useChat`, its context compaction, and request turns. */
export function createVacpChatRuntime(options: VacpChatRuntimeOptions): {
  agent: ToolLoopAgent<never, VacpAgentTools>;
  transport: ChatTransport<VacpChatMessage>;
} {
  const agent = createVacpToolLoopAgent({ ...options, activity: undefined });
  const direct = new DirectChatTransport({ agent, messageMetadata: createVacpMessageMetadata(options.model) });
  const transport = wrapTransportWithVacpContextCompaction(direct, options.contextCompactionPolicy, {
    availableToolNames: Object.keys(agent.tools),
  });
  const { activity } = options;
  return {
    agent,
    transport: activity ? withAgentActivity(transport, activity.control, activity.actor ?? vacpAgentActor) : transport,
  };
}
