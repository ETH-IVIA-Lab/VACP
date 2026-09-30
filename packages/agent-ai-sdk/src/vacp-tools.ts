import { tool, type Tool } from 'ai';
import { z } from 'zod';

import {
  vacpAgentTools,
  vacpNarrationGuidance,
  vacpProgressFields,
  VACP_NARRATION_MAX_LENGTH,
  type VacpActor,
  type VacpAgentActivityControl,
  type VacpCapabilitiesRequest,
  type VacpStateRequest,
} from '@vacp/protocol';
import type { VacpTransport } from '@vacp/transport-bridge';

import { createAgentTurns, type AgentTurns } from './agent-turn';
import { sanitizeToolPayload } from './sanitize-tool-payload';

const refs = z.array(z.templateLiteral(['vacp://', z.string()])).optional();
/** Text a model must fill with more than whitespace, as every transport checks it. */
const text = z.string().regex(/\S/);

const capabilitiesInput = z.object({
  refs,
  prefixes: refs,
  kinds: z.array(text).optional(),
  layers: z.array(text).optional(),
  includeActions: z.boolean().optional(),
  includeEdges: z.boolean().optional(),
  includeNodeData: z.boolean().optional(),
});

const stateInput = z.object({
  mode: z.enum(['auto', 'full', 'delta']).optional(),
  since: text.optional(),
  refs,
  includeSummary: z.boolean().optional(),
});

const executeInput = z.object({
  name: text,
  params: z.unknown().optional(),
  narration: z.string().trim().min(1).max(VACP_NARRATION_MAX_LENGTH).describe(vacpNarrationGuidance),
  call_id: z.string().optional(),
});

const progressInput = z.object({
  message: z.string().trim().min(1).max(VACP_NARRATION_MAX_LENGTH).describe(vacpProgressFields.message),
  done: z.boolean().default(false).describe(vacpProgressFields.done),
});

type ProgressResult = { ok: true } | { ok: false; reason: string };

/** The agent tools of `vacpAgentTools`. `vacp_progress` is present when the host supplies an activity channel. */
export type VacpAgentTools = {
  vacp_observe: Tool<Record<string, never>, unknown>;
  vacp_capabilities: Tool<VacpCapabilitiesRequest, unknown>;
  vacp_state: Tool<VacpStateRequest, unknown>;
  vacp_execute: Tool<z.output<typeof executeInput>, unknown>;
  vacp_progress?: Tool<z.output<typeof progressInput>, ProgressResult>;
};

export type VacpAgentToolsOptions = {
  transport: VacpTransport;
  /** The host's activity channel. It adds `vacp_progress` and one public activity per turn. */
  activity?: Pick<VacpAgentActivityControl, 'beginAgentActivity'>;
  /** The agent that steps and turns are attributed to. Defaults to `{ id: 'agent', label: 'Assistant' }`. */
  actor?: VacpActor;
};

const defaultActor: VacpActor = { id: 'agent', kind: 'agent', label: 'Assistant' };

/** The tools and the turns they narrate, shared by the public builder and the agent factories. */
export function buildVacpAgentTools(options: VacpAgentToolsOptions): { tools: VacpAgentTools; turns?: AgentTurns } {
  const { transport } = options;
  const actor = options.actor ?? defaultActor;
  const turns = options.activity ? createAgentTurns(options.activity, actor) : undefined;
  const read = async (work: Promise<unknown>) => sanitizeToolPayload(await work);
  const tools: VacpAgentTools = {
    vacp_observe: tool({
      description: vacpAgentTools.vacp_observe.description,
      inputSchema: z.object({}),
      execute: () => read(transport.vacp_observe()),
    }),
    vacp_capabilities: tool({
      description: vacpAgentTools.vacp_capabilities.description,
      inputSchema: capabilitiesInput,
      execute: (input) => read(transport.vacp_capabilities(input)),
    }),
    vacp_state: tool({
      description: vacpAgentTools.vacp_state.description,
      inputSchema: stateInput,
      execute: (input) => read(transport.vacp_state(input)),
    }),
    vacp_execute: tool({
      description: vacpAgentTools.vacp_execute.description,
      inputSchema: executeInput,
      execute: (input) =>
        read(transport.vacp_execute(input.name, input.params, input.call_id, { actor, narration: input.narration })),
    }),
  };
  if (turns)
    tools.vacp_progress = tool({
      description: vacpAgentTools.vacp_progress.description,
      inputSchema: progressInput,
      execute: ({ message, done }): ProgressResult =>
        turns.progress(message, done)
          ? { ok: true }
          : { ok: false, reason: 'Progress is not being shown to the person right now; continue the task.' },
    });
  return { tools, turns };
}

/**
 * The agent tools over one transport, for a host that runs its own model loop. The host calls
 * `end` with the outcome when its turn ends, so a turn the model opened through `vacp_progress`
 * closes with the request.
 */
export function createVacpAgentTools(options: VacpAgentToolsOptions): {
  tools: VacpAgentTools;
  end(outcome?: 'completed' | 'failed' | 'cancelled'): void;
} {
  const { tools, turns } = buildVacpAgentTools(options);
  return { tools, end: (outcome) => turns?.end(outcome) };
}
