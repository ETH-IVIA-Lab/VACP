import type { VacpActor, VacpPageBridge } from '@vacp/protocol';
import type { LanguageModel, TelemetryOptions, ToolLoopAgentSettings } from 'ai';

import type { Act, Scenario } from './core/scenario';
import type { Trace } from './core/trace';
import type { ModelPrice } from './core/usage';

/** A WebMCP tool as the page registers it. */
export type PageTool = { name: string; description: string; inputSchema: Record<string, unknown> };

/** A browser-side failure of a WebMCP tool, with the message the browser reports. */
export class ToolError extends Error {
  override name = 'ToolError';
}

/** The page's runtime as an agent reaches it across the browser boundary. */
export type AgentBridge = Pick<
  VacpPageBridge,
  'version' | 'observe' | 'getCapabilities' | 'getState' | 'execute' | 'beginAgentActivity'
>;

/** The page a condition's agent works on. */
export interface AgentPage {
  /** The page's WebMCP catalog as the browser registers it. */
  tools(): Promise<PageTool[]>;
  /** Run a WebMCP tool as the browser does for an agent. A browser-side failure throws `ToolError`. */
  callTool(name: string, input: unknown): Promise<string>;
  readonly bridge: AgentBridge;
  /** Execute one scenario action through VACP as `actor`, and throw when it does not succeed. */
  act(act: Act, actor: VacpActor): Promise<unknown>;
}

export type ProviderConfig =
  | { kind: 'openai-compatible'; baseURL: string; apiKey: string }
  | { kind: 'anthropic'; apiKey?: string; baseURL?: string }
  | { kind: 'openai'; apiKey?: string; baseURL?: string };

export type ModelConfig = {
  /** Key into the suite's providers. */
  provider: string;
  /** The id the provider serves, e.g. `gpt-6-luna` or `claude-sonnet-5-5`. */
  id: string;
  /** Unset for models without a published rate: cost then reads as unknown, never as zero. */
  price?: ModelPrice;
  /** Provider options sent with every call, such as reasoning effort. */
  options?: ToolLoopAgentSettings['providerOptions'];
  /** Context window in tokens, for loops that plan compaction around it. */
  contextWindow?: number;
};

export type ResolvedModel = Omit<ModelConfig, 'provider'> & {
  key: string;
  provider: { key: string } & ProviderConfig;
  /** The model through the suite's provider registry, so every AI SDK condition calls it the same way. */
  language: LanguageModel;
};

/** How a host names its tools to the model. A host that aliases WebMCP names maps them back. */
export type RecordOptions = { toolName?(name: string): string };

/**
 * The run's AI SDK telemetry. It exports OpenTelemetry spans under the run's span and fills the run's
 * `Trace`, so a condition passes it to every AI SDK call it makes.
 */
export type TelemetryFor = (options?: RecordOptions) => TelemetryOptions;

type ConversationInput = {
  page: AgentPage;
  scenario: Scenario;
  trace: Trace;
  signal: AbortSignal;
  maxSteps: number;
  telemetry: TelemetryFor;
};

/** `done` means the agent answered. `max-steps` means it was still calling tools when the budget ran out. */
export type Reply = { text: string; stop: 'done' | 'max-steps' | 'length' };

/** One conversation over one page. Each `say` resolves once the agent has settled. */
export type Conversation = {
  say(message: string): Promise<Reply>;
  /** Release what the conversation holds outside the page, such as an agent session or its sandbox. */
  close?(): Promise<void>;
};

/** What a condition is made of, built from the values its agent receives. Each invocation records it. */
export type ConditionDescription = {
  loop: string;
  instructions?: string;
  tools: string;
  settings?: Record<string, unknown>;
};

/** A condition started for one flow: one model, many conversations. */
export type ConditionSession = {
  description: ConditionDescription;
  conversation(input: ConversationInput): Promise<Conversation>;
  close?(): Promise<void>;
};

type ConditionStart = {
  signal: AbortSignal;
  /** A directory this condition owns outside the repository, for sandboxes and runtime state. */
  workspace: string;
};

/**
 * One arm of the experiment. An `agent` condition runs a model. An `oracle` plays each scenario's
 * reference solution, so every scenario must pass under it. A `control` does nothing, so no scenario
 * may pass under it.
 */
export type Condition =
  | { kind: 'agent'; start(input: ConditionStart & { model: ResolvedModel }): Promise<ConditionSession> }
  | { kind: 'oracle' | 'control'; start(input: ConditionStart): Promise<ConditionSession> };
