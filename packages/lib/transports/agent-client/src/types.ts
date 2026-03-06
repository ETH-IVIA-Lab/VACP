import type {
  VacpActionResult,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpRuntimeBridge,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
  VacpWindowBridge,
} from '@vacp/core';

export type VacpBridgeLike = VacpWindowBridge & Partial<VacpRuntimeBridge>;

export type VacpCapabilitiesOptions = VacpCapabilitiesRequest;

export type VacpStateOptions = VacpStateRequest;

export type VacpExecuteEnvelope = VacpActionResult;

export interface VacpTransportContract {
  vacp_capabilities: (options?: VacpCapabilitiesOptions) => Promise<VacpCapabilitiesSnapshot>;
  vacp_state: (options?: VacpStateOptions) => Promise<VacpStateSnapshot | VacpStateUpdate>;
  vacp_execute: (name: string, params?: unknown, call_id?: string) => Promise<VacpExecuteEnvelope>;
}

export type VacpAgentToolName = 'vacp_capabilities' | 'vacp_state' | 'vacp_execute';

export type VacpAgentToolEvent = {
  at: string;
  toolName: VacpAgentToolName;
  status: 'started' | 'succeeded' | 'failed';
  requestedInput?: unknown;
  input?: unknown;
  inputNote?: string;
  output?: unknown;
  error?: string;
};

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
  provider?: VacpLLMProvider;
  providerName?: string;
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
  temperature?: number;
  maxSteps?: number;
  maxOutputTokens?: number;
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

export type VacpAgentFactoryOptions = {
  config: VacpLLMConfig;
  transport: VacpTransportContract;
  instructions?: string;
  interactionPolicy?: VacpAgentInteractionPolicy;
  contextCompactionPolicy?: VacpContextCompactionPolicy;
  onToolEvent?: (event: VacpAgentToolEvent) => void;
};
