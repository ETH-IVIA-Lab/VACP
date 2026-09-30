import type { InferUITools, LanguageModel, TelemetryOptions, ToolLoopAgentSettings, UIMessage } from 'ai';
import type { VacpAgentTools, VacpAgentToolsOptions } from './vacp-tools';

export type VacpTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  textTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheTokens?: number;
};

export type VacpLLMProvider = 'openai-compatible' | 'gemini';

export type VacpLLMModelOption = {
  id: string;
  label: string;
  description?: string;
};

export type VacpLLMModelListOptions = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

export type VacpChatMessageMetadata = {
  /** The model's provider id, such as `openai.chat`. */
  provider?: string;
  model?: string;
  stepUsage?: VacpTokenUsage;
  totalUsage?: VacpTokenUsage;
  finishedAt?: string;
};

export type VacpLLMConfig = {
  provider: VacpLLMProvider;
  providerName: string;
  baseURL: string;
  apiKey: string;
  model: string;
};

export type VacpContextCompactionPolicy = {
  enabled?: boolean;
  maxTurns?: number;
  preserveFullToolPayloadTurns?: number;
  preserveReasoningTurns?: number;
  maxTextCharsPerPart?: number;
  maxToolJsonCharsPerPart?: number;
};

export type VacpContextCompactionOptions = {
  availableToolNames?: readonly string[];
};

export type VacpAgentInteractionPolicy = {
  /** When true, the agent should demonstrate answers through visible VACP interactions. */
  requireUiDemonstration?: boolean;
  /** Minimum semantic execute calls expected per user turn when actions exist. */
  minExecuteCallsPerTurn?: number;
  /** Minimum total tool calls expected per turn. */
  minToolCallsPerTurn?: number;
};

export type VacpAgentFactoryOptions = VacpAgentToolsOptions & {
  /** The model the agent calls. `createVacpLLMModel(config)` builds one from a `VacpLLMConfig`. */
  model: LanguageModel;
  instructions?: string;
  interactionPolicy?: VacpAgentInteractionPolicy;
  contextCompactionPolicy?: VacpContextCompactionPolicy;
  /** Model calls per request. Defaults to 8. */
  maxSteps?: number;
  /** Defaults to 0.2. */
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  providerOptions?: ToolLoopAgentSettings['providerOptions'];
  /**
   * AI SDK telemetry for the agent's calls: integrations such as `@ai-sdk/otel`'s `OpenTelemetry`,
   * content capture, and a `functionId`. Registered integrations apply when this is omitted.
   */
  telemetry?: TelemetryOptions;
};

export type VacpChatMessage = UIMessage<VacpChatMessageMetadata, never, InferUITools<VacpAgentTools>>;
