import type { UIMessage } from 'ai';

import { sanitizeToolPayload } from './sanitize-tool-payload';

import type { VacpContextCompactionPolicy } from './types';

export const defaultVacpContextCompactionPolicy: Required<VacpContextCompactionPolicy> = {
  enabled: true,
  maxTurns: 8,
  preserveFullToolPayloadTurns: 2,
  preserveReasoningTurns: 1,
  maxTextCharsPerPart: 1600,
  maxToolJsonCharsPerPart: 1200,
};

type ResolvedPolicy = Required<VacpContextCompactionPolicy>;
type UiPart = UIMessage['parts'][number];

function resolvePolicy(policy: VacpContextCompactionPolicy | undefined): ResolvedPolicy {
  if (!policy) return { ...defaultVacpContextCompactionPolicy };
  return { ...defaultVacpContextCompactionPolicy, ...policy };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function toJsonPreview(value: unknown, maxChars: number): string {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return 'null';
    return truncateText(raw, maxChars);
  } catch {
    return '[unserializable]';
  }
}

function partToolName(part: UiPart): string {
  if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') return part.toolName;
  if (part.type.startsWith('tool-')) return part.type.slice(5);
  return part.type;
}

function isToolPart(part: UiPart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function summarizeToolPart(part: UiPart, policy: ResolvedPolicy): string {
  const name = partToolName(part);
  const state = 'state' in part ? String(part.state ?? '') : 'unknown';
  const callId = 'toolCallId' in part ? String(part.toolCallId ?? '') : '';
  const input = 'input' in part ? toJsonPreview(part.input, policy.maxToolJsonCharsPerPart) : '';
  const output = 'output' in part ? toJsonPreview(part.output, policy.maxToolJsonCharsPerPart) : '';
  const error = 'errorText' in part && part.errorText ? String(part.errorText) : '';

  const segments = [
    `Tool ${name}`,
    `state=${state}`,
    callId ? `callId=${callId}` : '',
    input ? `input=${input}` : '',
    output ? `output=${output}` : '',
    error ? `error=${truncateText(error, Math.floor(policy.maxTextCharsPerPart / 2))}` : '',
  ].filter(Boolean);

  return segments.join(' | ');
}

function sanitizeUiPart(part: UiPart): UiPart {
  const next = { ...part } as Record<string, unknown>;
  if ('input' in next) next.input = sanitizeToolPayload(next.input);
  if ('output' in next) next.output = sanitizeToolPayload(next.output);
  if ('rawInput' in next) next.rawInput = sanitizeToolPayload(next.rawInput);
  if ('data' in next) next.data = sanitizeToolPayload(next.data);
  if ('providerMetadata' in next) next.providerMetadata = sanitizeToolPayload(next.providerMetadata);
  if ('callProviderMetadata' in next) next.callProviderMetadata = sanitizeToolPayload(next.callProviderMetadata);
  if ('approval' in next) next.approval = sanitizeToolPayload(next.approval);
  return next as UiPart;
}

function sanitizeUiMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    metadata: sanitizeToolPayload(message.metadata),
    parts: message.parts.map((part) => sanitizeUiPart(part)),
  }));
}

function messageSummaryForError(message: UIMessage | undefined): string {
  if (!message) return 'missing-message';
  const parts = message.parts
    .map((part) => {
      if (part.type === 'dynamic-tool' && typeof part.toolName === 'string') return `dynamic-tool:${part.toolName}`;
      return part.type;
    })
    .join(',');
  return `${message.role}:${message.id}:${parts}`;
}

function compactAssistantParts(
  message: UIMessage,
  msgIndex: number,
  policy: ResolvedPolicy,
  fullToolPayloadMessageIndices: Set<number>,
  reasoningMessageIndices: Set<number>,
  isOldTurn: boolean,
): UiPart[] {
  const compacted: UiPart[] = [];
  for (const part of message.parts) {
    if (part.type === 'step-start') continue;

    if (part.type === 'reasoning') {
      if (!reasoningMessageIndices.has(msgIndex) || isOldTurn) continue;
      compacted.push({ ...part, text: truncateText(part.text, policy.maxTextCharsPerPart) });
      continue;
    }

    if (part.type === 'text') {
      compacted.push({ ...part, text: truncateText(part.text, policy.maxTextCharsPerPart) });
      continue;
    }

    if (isToolPart(part)) {
      if (!isOldTurn && fullToolPayloadMessageIndices.has(msgIndex)) {
        compacted.push(part);
      } else {
        compacted.push({ type: 'text', text: summarizeToolPart(part, policy) });
      }
      continue;
    }

    if (!isOldTurn) compacted.push(part);
  }

  if (compacted.length > 0) return compacted;
  return [{ type: 'text', text: '[older context omitted for efficiency]' }];
}

function firstIndexToPreserve(messages: UIMessage[], maxTurns: number): number {
  const userIndices = messages.reduce<number[]>((acc, message, idx) => {
    if (message.role === 'user') acc.push(idx);
    return acc;
  }, []);
  if (userIndices.length <= maxTurns) return 0;
  return userIndices[userIndices.length - maxTurns] ?? 0;
}

function compactMessagesForModel(messages: UIMessage[], policy: ResolvedPolicy): UIMessage[] {
  if (!policy.enabled) return messages;
  if (messages.length === 0) return messages;

  const preserveFromIndex = firstIndexToPreserve(messages, policy.maxTurns);
  const assistantIndices = messages.reduce<number[]>((acc, message, idx) => {
    if (message.role === 'assistant') acc.push(idx);
    return acc;
  }, []);

  const fullToolPayloadMessageIndices = new Set(
    assistantIndices.slice(Math.max(0, assistantIndices.length - policy.preserveFullToolPayloadTurns)),
  );
  const reasoningMessageIndices = new Set(
    assistantIndices.slice(Math.max(0, assistantIndices.length - policy.preserveReasoningTurns)),
  );

  return messages.map((message, idx) => {
    const isOldTurn = idx < preserveFromIndex;
    if (message.role !== 'assistant') {
      return {
        ...message,
        parts: message.parts.map((part) =>
          part.type === 'text' ? { ...part, text: truncateText(part.text, policy.maxTextCharsPerPart) } : part,
        ),
      };
    }

    return {
      ...message,
      parts: compactAssistantParts(
        message,
        idx,
        policy,
        fullToolPayloadMessageIndices,
        reasoningMessageIndices,
        isOldTurn,
      ),
    };
  });
}

export function wrapTransportWithVacpContextCompaction<TTransport>(
  transport: TTransport,
  policy: VacpContextCompactionPolicy | undefined,
): TTransport {
  const resolved = resolvePolicy(policy);
  const base = transport as {
    sendMessages: (options: unknown) => Promise<ReadableStream<unknown>>;
    reconnectToStream: (options: unknown) => Promise<ReadableStream<unknown> | null>;
  };
  if (!resolved.enabled) return transport;

  return {
    ...base,
    sendMessages: async (options: unknown) => {
      if (!options || typeof options !== 'object' || !('messages' in options)) {
        return await base.sendMessages(options);
      }

      const rawMessages = (options as { messages: unknown }).messages;
      if (!Array.isArray(rawMessages)) return await base.sendMessages(options);

      const compacted = compactMessagesForModel(rawMessages as UIMessage[], resolved);
      const sanitized = sanitizeUiMessages(compacted);
      const nextOptions = { ...options, messages: sanitized };
      try {
        return await base.sendMessages(nextOptions);
      } catch (error) {
        if (error instanceof Error && /ModelMessage\[\] schema|Invalid prompt/.test(error.message)) {
          const recent = sanitized
            .slice(-3)
            .map((message) => messageSummaryForError(message))
            .join(' | ');
          throw new Error(`Chat prompt validation failed after sanitization. Recent messages: ${recent}`, {
            cause: error,
          });
        }
        throw error;
      }
    },
  } as TTransport;
}
