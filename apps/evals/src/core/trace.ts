import { addUsage, noUsage, sameUsage, type Usage } from './usage';

/** One transcript entry. Tool entries carry the registered tool name. */
export type TraceTurn = {
  role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  name?: string;
  thinking?: string;
};

/** `read` marks a graph or state read, whose payload size is the cost driver the evals exist to move. */
export type ToolRecord = { name: string; read: boolean; ms: number; ok: boolean; chars: number };

export type StepRecord = {
  turn: number;
  ms: number;
  /** The model id the provider says served this call. */
  modelId: string | undefined;
  finishReason: string;
  usage: Usage;
};

/** The graph and state reads of both tool surfaces: the bridge tools and WebMCP's `vacp` namespace. */
const readTools = new Set([
  'vacp_observe',
  'vacp_capabilities',
  'vacp_state',
  'vacp.observe',
  'vacp.capabilities',
  'vacp.state',
]);

/** A VACP result envelope with `ok: false` is a failed call, however the tool returned it. */
function failedEnvelope(output: string): boolean {
  if (!output.startsWith('{')) return false;
  try {
    return (JSON.parse(output) as { ok?: unknown }).ok === false;
  } catch {
    return false;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Collects one run's transcript and measurements as the agent works. */
export class Trace {
  readonly turns: TraceTurn[] = [];
  readonly steps: StepRecord[] = [];
  readonly tools: ToolRecord[] = [];
  /** Tool catalogs the model saw, by fingerprint, in order. A change rewrites the cached prompt prefix. */
  readonly catalogs: string[] = [];
  #turn = -1;

  system(content: string) {
    this.turns.push({ role: 'system', content });
  }

  /** A user turn begins. The runner opens every turn, so steps carry the same turn numbers in every condition. */
  beginTurn(message: string) {
    this.#turn++;
    this.turns.push({ role: 'user', content: message });
  }

  assistant(content: string, thinking?: string) {
    if (content.trim() || thinking) this.turns.push({ role: 'assistant', content, ...(thinking ? { thinking } : {}) });
  }

  catalog(fingerprint: string) {
    if (this.catalogs.at(-1) !== fingerprint) this.catalogs.push(fingerprint);
  }

  /** Record one model call's step and return its index. */
  step(step: Omit<StepRecord, 'turn'>): number {
    return this.steps.push({ ...step, turn: this.#turn }) - 1;
  }

  /**
   * A call's reported total usage is authoritative. Some runtimes report usage only for the whole call,
   * or step usage that misses cache reads, so when the call's steps do not add up to it, its last step
   * carries the total.
   */
  settleCall(indexes: readonly number[], total: Usage) {
    const last = indexes.at(-1);
    if (last === undefined) return;
    const recorded = indexes.map((index) => this.steps[index]!.usage).reduce(addUsage, noUsage);
    if (sameUsage(recorded, total)) return;
    for (const index of indexes) this.steps[index]!.usage = noUsage;
    this.steps[last]!.usage = total;
  }

  toolCall(name: string, input: unknown) {
    this.turns.push({ role: 'tool_call', name, content: text(input) });
  }

  /** `ok` is false for a call that threw. A VACP result envelope with `ok: false` also counts as failed. */
  toolResult(name: string, output: string, ms: number, ok: boolean) {
    this.turns.push({ role: 'tool_result', name, content: output });
    this.tools.push({ name, read: readTools.has(name), ms, ok: ok && !failedEnvelope(output), chars: output.length });
  }

  usage(): Usage {
    return this.steps.map((step) => step.usage).reduce(addUsage, noUsage);
  }
}
