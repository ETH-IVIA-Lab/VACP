import { tool, type Tool } from 'ai';
import type { VacpActor } from '@ethivia/vacp-sdk';
import { z } from 'zod';

import {
  parseVacpNarration,
  VACP_NARRATION_MAX_LENGTH,
  vacpAgentTools,
  type VacpCapabilitiesRequest,
  type VacpExecuteInput,
  vacpNarrationGuidance,
  vacpProgressFields,
  type VacpProgressInput,
  type VacpStateRequest,
  createVacpToolHandlers,
  type VacpToolBridge,
  type VacpToolResult,
} from '@ethivia/vacp-sdk/agent';

const refs = z.array(z.templateLiteral(['vacp://', z.string()])).optional();
/** Text a model must fill with more than whitespace, as every transport checks it. */
const text = z.string().regex(/\S/);

/** A sentence the narration parser accepts, published with the parser's bound in code points. */
const sentence = (field: string, description: string) =>
  z
    .string()
    .superRefine((value, ctx) => {
      try {
        parseVacpNarration(value, field);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
      }
    })
    .meta({ minLength: 1, maxLength: VACP_NARRATION_MAX_LENGTH, description });

const capabilitiesInput = z.object({
  refs,
  prefixes: refs,
  kinds: z.array(text).optional(),
  layers: z.array(text).optional(),
  includeActions: z.boolean().optional(),
  includeEdges: z.boolean().optional(),
  includeNodeData: z.boolean().optional(),
});

const stateInput = z.object({ since: text.optional(), refs, includeSummary: z.boolean().optional() });

const executeInput = z.object({
  name: text,
  params: z.unknown().optional(),
  narration: sentence('narration', vacpNarrationGuidance),
});

const progressInput = z.object({
  message: sentence('message', vacpProgressFields.message),
  done: z.boolean().optional().describe(vacpProgressFields.done),
});

/** The tools of `vacpAgentTools`, each answering with the bounded result of `createVacpToolHandlers`. */
export type VacpAgentTools = {
  vacp_observe: Tool<Record<string, never>, VacpToolResult>;
  vacp_capabilities: Tool<VacpCapabilitiesRequest, VacpToolResult>;
  vacp_state: Tool<VacpStateRequest, VacpToolResult>;
  vacp_execute: Tool<Omit<VacpExecuteInput, 'callId'>, VacpToolResult>;
  vacp_progress: Tool<VacpProgressInput, VacpToolResult>;
};

/**
 * The agent tools over a page's runtime or bridge, attributed to `actor`, `vacpAgentActor` by default.
 * Each call forwards the AI SDK's abort signal, so a cancelled request cancels its running step and a
 * turn its sentence opened. Each step runs under the AI SDK's tool call ID, so its provenance record
 * and the chat message part share one ID.
 */
export function createVacpAgentTools(runtime: VacpToolBridge, options: { actor?: VacpActor } = {}): VacpAgentTools {
  const handlers = createVacpToolHandlers(runtime, options);
  return {
    vacp_observe: tool({
      description: vacpAgentTools.vacp_observe.description,
      inputSchema: z.object({}),
      execute: () => handlers.vacp_observe(),
    }),
    vacp_capabilities: tool({
      description: vacpAgentTools.vacp_capabilities.description,
      inputSchema: capabilitiesInput,
      execute: (input) => handlers.vacp_capabilities(input),
    }),
    vacp_state: tool({
      description: vacpAgentTools.vacp_state.description,
      inputSchema: stateInput,
      execute: (input) => handlers.vacp_state(input),
    }),
    vacp_execute: tool({
      description: vacpAgentTools.vacp_execute.description,
      inputSchema: executeInput,
      execute: (input, { abortSignal, toolCallId }) =>
        handlers.vacp_execute({ ...input, callId: toolCallId }, abortSignal),
    }),
    vacp_progress: tool({
      description: vacpAgentTools.vacp_progress.description,
      inputSchema: progressInput,
      execute: (input, { abortSignal }) => handlers.vacp_progress(input, abortSignal),
    }),
  };
}
