import {
  DirectChatTransport,
  ToolLoopAgent,
  isStepCount,
  type ChatTransport,
  type LanguageModel,
  type LanguageModelUsage,
  type StreamTextTransform,
  type ToolLoopAgentSettings,
} from 'ai';

import { withAgentActivity } from './activity-transport';
import type { AgentTurns } from './agent-turn';
import { wrapTransportWithVacpContextCompaction } from './context-compaction';
import { buildVacpAgentInstructions } from './instructions';
import type { VacpAgentFactoryOptions, VacpChatMessage, VacpChatMessageMetadata, VacpTokenUsage } from './types';
import { buildVacpAgentTools, type VacpAgentTools } from './vacp-tools';

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

/** A tool loop whose requests close the turn the model opened, however they end. */
class VacpToolLoopAgent extends ToolLoopAgent<never, VacpAgentTools> {
  readonly #turns: AgentTurns | undefined;

  constructor(settings: ToolLoopAgentSettings<never, VacpAgentTools>, turns: AgentTurns | undefined) {
    // A turn the model opened through vacp_progress closes with the request, chat transport or not.
    super({ ...settings, onEnd: () => turns?.end() });
    this.#turns = turns;
  }

  #fail(signal: AbortSignal | undefined) {
    this.#turns?.end(signal?.aborted ? 'cancelled' : 'failed');
  }

  override async generate(options: Parameters<ToolLoopAgent<never, VacpAgentTools>['generate']>[0]) {
    try {
      return await super.generate(options);
    } catch (error) {
      this.#fail(options.abortSignal);
      throw error;
    }
  }

  override async stream(options: Parameters<ToolLoopAgent<never, VacpAgentTools>['stream']>[0]) {
    // A step that fails or is aborted after an earlier one finished ends the stream as a part, so the
    // request's own error and abort parts close the turn.
    const closing: StreamTextTransform<VacpAgentTools> = () =>
      new TransformStream({
        transform: (part, controller) => {
          if (part.type === 'error') this.#turns?.end('failed');
          else if (part.type === 'abort') this.#turns?.end('cancelled');
          controller.enqueue(part);
        },
      });
    let result: Awaited<ReturnType<ToolLoopAgent<never, VacpAgentTools>['stream']>>;
    try {
      result = await super.stream({
        ...options,
        experimental_transform: [closing, ...[options.experimental_transform ?? []].flat()],
      });
    } catch (error) {
      this.#fail(options.abortSignal);
      throw error;
    }
    // A stream that throws before any step finished rejects its text.
    result.text.then(undefined, () => this.#fail(options.abortSignal));
    return result;
  }
}

function createAgent(options: VacpAgentFactoryOptions) {
  const { tools, turns } = buildVacpAgentTools(options);
  const agent = new VacpToolLoopAgent(
    {
      model: options.model,
      instructions: buildVacpAgentInstructions({
        baseInstructions: options.instructions,
        interactionPolicy: options.interactionPolicy,
      }),
      stopWhen: isStepCount(options.maxSteps ?? vacpAgentDefaults.maxSteps),
      temperature: options.temperature ?? vacpAgentDefaults.temperature,
      maxOutputTokens: options.maxOutputTokens,
      maxRetries: options.maxRetries,
      providerOptions: options.providerOptions,
      tools,
      telemetry: options.telemetry,
    },
    turns,
  );
  return { agent, turns };
}

export function createVacpToolLoopAgent(options: VacpAgentFactoryOptions): ToolLoopAgent<never, VacpAgentTools> {
  return createAgent(options).agent;
}

export function createVacpChatRuntime(options: VacpAgentFactoryOptions): {
  agent: ToolLoopAgent<never, VacpAgentTools>;
  transport: ChatTransport<VacpChatMessage>;
} {
  const { agent, turns } = createAgent(options);
  const baseTransport = new DirectChatTransport({ agent, messageMetadata: createVacpMessageMetadata(options.model) });

  const transport = wrapTransportWithVacpContextCompaction(baseTransport, options.contextCompactionPolicy, {
    availableToolNames: Object.keys(agent.tools),
  });

  return { agent, transport: turns ? withAgentActivity(transport, turns) : transport };
}
