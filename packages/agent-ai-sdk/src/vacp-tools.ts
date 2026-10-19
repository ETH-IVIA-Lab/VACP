import { tool, type Tool } from 'ai';
import { z } from 'zod';

import {
  parseVacpNarration,
  vacpAgentTools,
  vacpNarrationGuidance,
  vacpProgressFields,
  VACP_NARRATION_MAX_LENGTH,
  type VacpCapabilitiesRequest,
  type VacpStateRequest,
  type VacpToolResult,
} from '@ethivia/vacp-protocol';
import type { VacpExecuteInput, VacpProgressInput, VacpTransport } from '@ethivia/vacp-bridge';

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
  call_id: z.string().optional(),
});

const progressInput = z.object({
  message: sentence('message', vacpProgressFields.message),
  done: z.boolean().optional().describe(vacpProgressFields.done),
});

/** The tools of `vacpAgentTools`, each answering with the transport's bounded result. */
export type VacpAgentTools = {
  vacp_observe: Tool<Record<string, never>, VacpToolResult>;
  vacp_capabilities: Tool<VacpCapabilitiesRequest, VacpToolResult>;
  vacp_state: Tool<VacpStateRequest, VacpToolResult>;
  vacp_execute: Tool<VacpExecuteInput, VacpToolResult>;
  vacp_progress: Tool<VacpProgressInput, VacpToolResult>;
};

/**
 * The agent tools over one transport. Each call forwards the AI SDK's abort signal, so a cancelled
 * request cancels its running step and a turn its sentence opened.
 */
export function createVacpAgentTools(transport: VacpTransport): VacpAgentTools {
  return {
    vacp_observe: tool({
      description: vacpAgentTools.vacp_observe.description,
      inputSchema: z.object({}),
      execute: () => transport.vacp_observe(),
    }),
    vacp_capabilities: tool({
      description: vacpAgentTools.vacp_capabilities.description,
      inputSchema: capabilitiesInput,
      execute: (input) => transport.vacp_capabilities(input),
    }),
    vacp_state: tool({
      description: vacpAgentTools.vacp_state.description,
      inputSchema: stateInput,
      execute: (input) => transport.vacp_state(input),
    }),
    vacp_execute: tool({
      description: vacpAgentTools.vacp_execute.description,
      inputSchema: executeInput,
      execute: (input, { abortSignal }) => transport.vacp_execute(input, abortSignal),
    }),
    vacp_progress: tool({
      description: vacpAgentTools.vacp_progress.description,
      inputSchema: progressInput,
      execute: (input, { abortSignal }) => transport.vacp_progress(input, abortSignal),
    }),
  };
}
