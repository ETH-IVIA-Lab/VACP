import type { InferUITools, LanguageModel, TelemetryOptions, ToolLoopAgentSettings, UIMessage } from 'ai';
import type { VacpActor } from '@ethivia/vacp-sdk';
import type { VacpAgentActivityControl, VacpToolBridge } from '@ethivia/vacp-sdk/agent';
import type { VacpAgentTools } from './vacp-tools';

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

export type VacpChatMessageMetadata = {
  /** The model's provider id, such as `openai.chat`. */
  provider?: string;
  model?: string;
  stepUsage?: VacpTokenUsage;
  totalUsage?: VacpTokenUsage;
  finishedAt?: string;
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

export type VacpAgentOptions = {
  /** Any AI SDK `LanguageModel`. */
  model: LanguageModel;
  /**
   * The page the tools read and act on: the `VacpRuntime`, or the bridge `getVacpBridge()` returns.
   * Each request opens one turn on it and closes the turn with the request's outcome.
   */
  runtime: VacpToolBridge & Pick<VacpAgentActivityControl, 'beginAgentActivity'>;
  /** Who the steps, sentences, and turns belong to. Defaults to `vacpAgentActor`. */
  actor?: VacpActor;
  /** Replaces `defaultVacpAgentInstructions`. */
  instructions?: string;
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

export type VacpChatTransportOptions = VacpAgentOptions & {
  contextCompactionPolicy?: VacpContextCompactionPolicy;
};

export type VacpChatMessage = UIMessage<VacpChatMessageMetadata, never, InferUITools<VacpAgentTools>>;
