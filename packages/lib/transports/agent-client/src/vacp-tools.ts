import { tool } from 'ai';
import { z } from 'zod';

import type { VacpRef } from '@vacp/core';

import type {
  VacpAgentToolEvent,
  VacpAgentToolName,
  VacpCapabilitiesOptions,
  VacpStateOptions,
  VacpTransportContract,
} from './types';

type ToolOptions = {
  transport: VacpTransportContract;
  onToolEvent?: (event: VacpAgentToolEvent) => void;
};

function emit(
  onToolEvent: ((event: VacpAgentToolEvent) => void) | undefined,
  toolName: VacpAgentToolName,
  status: VacpAgentToolEvent['status'],
  payload?: { input?: unknown; output?: unknown; error?: string },
) {
  onToolEvent?.({
    at: new Date().toISOString(),
    toolName,
    status,
    ...payload,
  });
}

const stateOptionsSchema = z.object({
  mode: z.enum(['auto', 'full', 'delta']).optional(),
  since: z.string().min(1).optional(),
  refs: z.array(z.string().regex(/^vacp:\/\//)).optional(),
  includeSummary: z.boolean().optional(),
});

const nodeKinds = [
  'App',
  'View',
  'Visualization',
  'Mark',
  'EncodingChannel',
  'EncodedField',
  'Legend',
  'Axis',
  'Selection',
  'Param',
  'Widget',
  'DataHandle',
  'InteractionTarget',
] as const;

const layers = ['ConfigLayer', 'ViewLayer', 'VisualizationLayer', 'DataLayer', 'InteractionFeedbackLayer'] as const;

const capabilitiesOptionsSchema = z.object({
  refs: z.array(z.string().regex(/^vacp:\/\//)).optional(),
  prefixes: z.array(z.string().regex(/^vacp:\/\//)).optional(),
  kinds: z.array(z.enum(nodeKinds)).optional(),
  layers: z.array(z.enum(layers)).optional(),
  includeActions: z.boolean().optional(),
  includeEdges: z.boolean().optional(),
  includeNodeData: z.boolean().optional(),
});

const executeSchema = z.object({
  name: z.string().min(1),
  params: z.unknown().optional(),
  call_id: z.string().min(1).optional(),
});

function normalizeStateOptions(input: z.infer<typeof stateOptionsSchema>): VacpStateOptions | undefined {
  const normalized: VacpStateOptions = {};
  if (input.mode !== undefined) normalized.mode = input.mode;
  if (input.since !== undefined) normalized.since = input.since;
  if (input.includeSummary !== undefined) normalized.includeSummary = input.includeSummary;
  if (input.refs !== undefined) normalized.refs = input.refs.map((ref) => ref as VacpRef);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeCapabilitiesOptions(
  input: z.infer<typeof capabilitiesOptionsSchema>,
): VacpCapabilitiesOptions | undefined {
  const normalized: VacpCapabilitiesOptions = {};
  if (input.refs !== undefined) normalized.refs = input.refs.map((ref) => ref as VacpRef);
  if (input.prefixes !== undefined) normalized.prefixes = input.prefixes.map((ref) => ref as VacpRef);
  if (input.kinds !== undefined) normalized.kinds = input.kinds;
  if (input.layers !== undefined) normalized.layers = input.layers;
  if (input.includeActions !== undefined) normalized.includeActions = input.includeActions;
  if (input.includeEdges !== undefined) normalized.includeEdges = input.includeEdges;
  if (input.includeNodeData !== undefined) normalized.includeNodeData = input.includeNodeData;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createVacpTools(options: ToolOptions) {
  const { transport, onToolEvent } = options;

  return {
    vacp_capabilities: tool({
      description: 'Fetch VACP capabilities snapshot (graph + actions), optionally scoped.',
      inputSchema: capabilitiesOptionsSchema,
      execute: async (input) => {
        emit(onToolEvent, 'vacp_capabilities', 'started', { input });
        try {
          const options = normalizeCapabilitiesOptions(input);
          const output = await transport.vacp_capabilities(options);
          emit(onToolEvent, 'vacp_capabilities', 'succeeded', { input, output });
          return output;
        } catch (error) {
          emit(onToolEvent, 'vacp_capabilities', 'failed', { input, error: String(error) });
          throw error;
        }
      },
    }),

    vacp_state: tool({
      description: 'Fetch VACP state snapshot or delta update envelope.',
      inputSchema: stateOptionsSchema,
      execute: async (input) => {
        emit(onToolEvent, 'vacp_state', 'started', { input });
        try {
          const options = normalizeStateOptions(input);
          const output = await transport.vacp_state(options);
          emit(onToolEvent, 'vacp_state', 'succeeded', { input, output });
          return output;
        } catch (error) {
          emit(onToolEvent, 'vacp_state', 'failed', { input, error: String(error) });
          throw error;
        }
      },
    }),

    vacp_execute: tool({
      description: 'Execute a semantic VACP action by name and optional params.',
      inputSchema: executeSchema,
      execute: async (input) => {
        emit(onToolEvent, 'vacp_execute', 'started', { input });
        try {
          const output = await transport.vacp_execute(input.name, input.params, input.call_id);
          emit(onToolEvent, 'vacp_execute', 'succeeded', { input, output });
          return output;
        } catch (error) {
          emit(onToolEvent, 'vacp_execute', 'failed', { input, error: String(error) });
          throw error;
        }
      },
    }),
  };
}
