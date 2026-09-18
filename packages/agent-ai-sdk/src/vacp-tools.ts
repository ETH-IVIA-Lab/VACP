import { tool } from 'ai';
import { z } from 'zod';

import type { VacpRef } from '@vacp/protocol';

import type { VacpAgentToolEvent, VacpAgentToolName } from './types';
import type { VacpCapabilitiesRequest, VacpStateRequest } from '@vacp/protocol';
import type { VacpTransport } from '@vacp/transport-bridge';
import { sanitizeToolPayload } from './sanitize-tool-payload';

type ToolOptions = {
  transport: VacpTransport;
  onToolEvent?: (event: VacpAgentToolEvent) => void;
};

type NormalizedToolInput<T> = {
  options?: T;
  requestedInput?: unknown;
  input?: unknown;
  inputNote?: string;
};

function emit(
  onToolEvent: ((event: VacpAgentToolEvent) => void) | undefined,
  toolName: VacpAgentToolName,
  status: VacpAgentToolEvent['status'],
  payload?: { requestedInput?: unknown; input?: unknown; inputNote?: string; output?: unknown; error?: string },
) {
  onToolEvent?.({
    at: new Date().toISOString(),
    toolName,
    status,
    ...(payload
      ? {
          requestedInput: sanitizeToolPayload(payload.requestedInput),
          input: sanitizeToolPayload(payload.input),
          inputNote: payload.inputNote,
          output: sanitizeToolPayload(payload.output),
          error: payload.error,
        }
      : {}),
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

function appendNote(notes: string[], message: string) {
  if (!notes.includes(message)) notes.push(message);
}

function normalizeRefScope(values: string[] | undefined, notes: string[]): VacpRef[] | undefined {
  if (!values || values.length === 0) return undefined;
  const filtered = values.filter((ref) => ref !== 'vacp://');

  if (filtered.length !== values.length) {
    appendNote(notes, 'Normalized bare `vacp://` scope to an unscoped request.');
  }

  return filtered.length > 0 ? filtered.map((ref) => ref as VacpRef) : undefined;
}

function buildNormalizedInput<T>(
  requestedInput: unknown,
  options: T | undefined,
  notes: string[],
): NormalizedToolInput<T> {
  const sanitizedRequested = sanitizeToolPayload(requestedInput);
  const sanitizedEffective = sanitizeToolPayload(options);
  const inputNote = notes.length > 0 ? notes.join(' ') : undefined;
  const samePayload = JSON.stringify(sanitizedRequested ?? null) === JSON.stringify(sanitizedEffective ?? null);

  return {
    options,
    requestedInput: samePayload ? undefined : sanitizedRequested,
    input: sanitizedEffective,
    inputNote,
  };
}

function normalizeStateOptions(input: z.infer<typeof stateOptionsSchema>): NormalizedToolInput<VacpStateRequest> {
  const notes: string[] = [];
  const normalized: VacpStateRequest = {};

  if (input.mode !== undefined) normalized.mode = input.mode;

  if (input.since !== undefined) normalized.since = input.since;

  if (input.includeSummary !== undefined) normalized.includeSummary = input.includeSummary;
  const refs = normalizeRefScope(input.refs, notes);

  if (refs !== undefined) normalized.refs = refs;

  return buildNormalizedInput(input, Object.keys(normalized).length > 0 ? normalized : undefined, notes);
}

function normalizeCapabilitiesOptions(
  input: z.infer<typeof capabilitiesOptionsSchema>,
): NormalizedToolInput<VacpCapabilitiesRequest> {
  const notes: string[] = [];
  const normalized: VacpCapabilitiesRequest = {};
  const refs = normalizeRefScope(input.refs, notes);
  const prefixes = normalizeRefScope(input.prefixes, notes);

  if (refs !== undefined) normalized.refs = refs;

  if (prefixes !== undefined) normalized.prefixes = prefixes;

  if (input.kinds !== undefined) normalized.kinds = input.kinds;

  if (input.layers !== undefined) normalized.layers = input.layers;

  if (input.includeActions !== undefined) normalized.includeActions = input.includeActions;

  if (input.includeEdges !== undefined) normalized.includeEdges = input.includeEdges;

  const hasEffectiveScope = Boolean(
    (refs && refs.length) ||
    (prefixes && prefixes.length) ||
    (input.kinds && input.kinds.length) ||
    (input.layers && input.layers.length),
  );

  if (hasEffectiveScope) {
    if (input.includeNodeData !== undefined) normalized.includeNodeData = input.includeNodeData;
  } else {
    if (input.includeNodeData !== false) {
      normalized.includeNodeData = false;
      appendNote(notes, 'Defaulted `includeNodeData` to `false` for an unscoped capabilities read.');
    }
  }

  return buildNormalizedInput(input, Object.keys(normalized).length > 0 ? normalized : undefined, notes);
}

export function createVacpTools(options: ToolOptions) {
  const { transport, onToolEvent } = options;

  return {
    vacp_capabilities: tool({
      description: 'Fetch VACP capabilities snapshot (graph + actions), optionally scoped.',
      inputSchema: capabilitiesOptionsSchema,
      execute: async (input) => {
        const normalized = normalizeCapabilitiesOptions(input);
        emit(onToolEvent, 'vacp_capabilities', 'started', {
          requestedInput: normalized.requestedInput,
          input: normalized.input,
          inputNote: normalized.inputNote,
        });

        try {
          const output = sanitizeToolPayload(await transport.vacp_capabilities(normalized.options));
          emit(onToolEvent, 'vacp_capabilities', 'succeeded', {
            requestedInput: normalized.requestedInput,
            input: normalized.input,
            inputNote: normalized.inputNote,
            output,
          });

          return output;
        } catch (error) {
          emit(onToolEvent, 'vacp_capabilities', 'failed', {
            requestedInput: normalized.requestedInput,
            input: normalized.input,
            inputNote: normalized.inputNote,
            error: String(error),
          });
          throw error;
        }
      },
    }),

    vacp_state: tool({
      description: 'Fetch VACP state snapshot or delta update envelope.',
      inputSchema: stateOptionsSchema,
      execute: async (input) => {
        const normalized = normalizeStateOptions(input);
        emit(onToolEvent, 'vacp_state', 'started', {
          requestedInput: normalized.requestedInput,
          input: normalized.input,
          inputNote: normalized.inputNote,
        });

        try {
          const output = sanitizeToolPayload(await transport.vacp_state(normalized.options));
          emit(onToolEvent, 'vacp_state', 'succeeded', {
            requestedInput: normalized.requestedInput,
            input: normalized.input,
            inputNote: normalized.inputNote,
            output,
          });

          return output;
        } catch (error) {
          emit(onToolEvent, 'vacp_state', 'failed', {
            requestedInput: normalized.requestedInput,
            input: normalized.input,
            inputNote: normalized.inputNote,
            error: String(error),
          });
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
          const output = sanitizeToolPayload(await transport.vacp_execute(input.name, input.params, input.call_id));
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
