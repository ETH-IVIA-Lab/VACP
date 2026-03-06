import type { UIMessage } from '@ai-sdk/react';
import { sanitizeToolPayload } from '@vacp/agent-client';

function safeJson(value: unknown): string {
  return JSON.stringify(sanitizeToolPayload(value) ?? null);
}

export function messageSyncSignature(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const partSig = message.parts
        .map((part) => {
          if (part.type === 'text' && 'text' in part) return `text:${part.text}`;
          if (part.type === 'reasoning' && 'text' in part) return `reasoning:${part.text}`;
          if ('input' in part || 'output' in part || 'rawInput' in part || 'data' in part) {
            const input = 'input' in part ? safeJson(part.input) : '';
            const output = 'output' in part ? safeJson(part.output) : '';
            const rawInput = 'rawInput' in part ? safeJson(part.rawInput) : '';
            const data = 'data' in part ? safeJson(part.data) : '';
            const state = 'state' in part ? String(part.state ?? '') : '';
            return `${part.type}:${state}:${input}:${output}:${rawInput}:${data}`;
          }
          return part.type;
        })
        .join(',');
      return `${message.role}:${safeJson(message.metadata)}:${partSig}`;
    })
    .join('|');
}
