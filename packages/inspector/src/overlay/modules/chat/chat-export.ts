import type { VacpChatMessage as UIMessage } from '@vacp/agent-ai-sdk';
import type { VacpAgentToolEvent, VacpLLMConfig } from '@vacp/agent-ai-sdk';
import { sanitizeToolPayload } from '@vacp/agent-ai-sdk';

type ExportConversationArgs = {
  scopeLabel: string;
  config: VacpLLMConfig;
  messages: UIMessage[];
  toolEvents?: VacpAgentToolEvent[];
  exportedAt?: string;
};

type UiPart = UIMessage['parts'][number];

type ToolEventMatcher = (toolName: string) => VacpAgentToolEvent | undefined;

function asJson(value: unknown): string {
  return JSON.stringify(sanitizeToolPayload(value) ?? null, null, 2);
}

function sameJson(a: unknown, b: unknown): boolean {
  return asJson(a) === asJson(b);
}

function fence(language: string, text: string): string {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

function toolName(part: UiPart): string {
  if (part.type === 'dynamic-tool' && 'toolName' in part && typeof part.toolName === 'string') return part.toolName;

  if (part.type.startsWith('tool-')) return part.type.slice(5);

  return part.type;
}

function formatReasoning(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function createToolEventMatcher(events: VacpAgentToolEvent[]): ToolEventMatcher {
  const completed = events.filter((event) => event.status !== 'started');
  const consumed = new Set<number>();

  return (toolName) => {
    for (let i = 0; i < completed.length; i += 1) {
      if (consumed.has(i)) continue;

      if (completed[i]?.toolName !== toolName) continue;
      consumed.add(i);

      return completed[i];
    }

    return undefined;
  };
}

function formatInputSections(args: { input?: unknown; requestedInput?: unknown; inputNote?: string }): string[] {
  const sections: string[] = [];

  const showRequestedInput =
    args.requestedInput !== undefined && (args.input === undefined || !sameJson(args.input, args.requestedInput));

  if (args.input !== undefined) {
    sections.push(['#### Input', fence('json', asJson(args.input))].join('\n\n'));
  }

  if (args.inputNote) {
    sections.push(`- Note: ${args.inputNote}`);
  }

  if (showRequestedInput) {
    sections.push(['#### Requested Input', fence('json', asJson(args.requestedInput))].join('\n\n'));
  }

  return sections;
}

function formatToolPart(part: UiPart, event: VacpAgentToolEvent | undefined): string | null {
  if (!(part.type.startsWith('tool-') || part.type === 'dynamic-tool')) return null;

  const sections = [`### Tool: ${toolName(part)}`];
  const metadata: string[] = [];

  if ('state' in part && part.state) metadata.push(`- State: \`${String(part.state)}\``);

  if ('toolCallId' in part && part.toolCallId) metadata.push(`- Call ID: \`${String(part.toolCallId)}\``);

  if (metadata.length > 0) sections.push(metadata.join('\n'));

  const effectiveInput = event?.input ?? ('input' in part ? part.input : undefined);
  const requestedInput = event?.requestedInput;
  sections.push(
    ...formatInputSections({
      input: effectiveInput,
      requestedInput,
      inputNote: event?.inputNote,
    }),
  );

  if ('output' in part && part.output !== undefined) {
    sections.push(['#### Output', fence('json', asJson(part.output))].join('\n\n'));
  }

  if ('errorText' in part && typeof part.errorText === 'string' && part.errorText.length) {
    sections.push(['#### Error', fence('text', part.errorText)].join('\n\n'));
  }

  return sections.join('\n\n');
}

function formatPart(part: UiPart, nextToolEvent: ToolEventMatcher): string | null {
  if (part.type === 'text' && 'text' in part) return part.text;

  if (part.type === 'reasoning' && 'text' in part) return `### Reasoning\n${formatReasoning(part.text)}`;

  if (part.type === 'step-start') return null;

  if ('data' in part) {
    return `### ${part.type}\n${fence('json', asJson(part.data))}`;
  }

  return formatToolPart(part, nextToolEvent(toolName(part)));
}

function formatMessage(message: UIMessage, index: number, nextToolEvent: ToolEventMatcher): string {
  const role =
    message.role === 'assistant'
      ? 'Agent'
      : message.role === 'user'
        ? 'You'
        : message.role === 'system'
          ? 'System'
          : 'Message';

  const parts = message.parts
    .map((part) => formatPart(part, nextToolEvent))
    .filter((part): part is string => Boolean(part));

  return [`## ${index + 1}. ${role}`, ...parts].join('\n\n');
}

function formatToolEvents(events: VacpAgentToolEvent[]): string {
  if (events.length === 0) return '';
  const sections = ['## Tool Event Timeline'];

  for (const event of events) {
    const blocks = [`### ${event.toolName}`, [`- At: \`${event.at}\``, `- Status: \`${event.status}\``].join('\n')];
    blocks.push(
      ...formatInputSections({ input: event.input, requestedInput: event.requestedInput, inputNote: event.inputNote }),
    );

    if (event.output !== undefined) {
      blocks.push(['#### Output', fence('json', asJson(event.output))].join('\n\n'));
    }

    if (event.error) {
      blocks.push(['#### Error', fence('text', event.error)].join('\n\n'));
    }

    sections.push(blocks.join('\n\n'));
  }

  return sections.join('\n\n');
}

export function exportConversationAsMarkdown(args: ExportConversationArgs): string {
  const exportedAt = args.exportedAt ?? new Date().toISOString();
  const nextToolEvent = createToolEventMatcher(args.toolEvents ?? []);

  const sections = [
    [
      '# Inspector Chat Conversation',
      `- View: ${args.scopeLabel}`,
      `- Provider: ${args.config.providerName}`,
      `- Model: ${args.config.model}`,
      `- Exported: ${exportedAt}`,
    ].join('\n'),
    ...args.messages.map((message, index) => formatMessage(message, index, nextToolEvent)),
  ];

  if ((args.toolEvents?.length ?? 0) > 0) {
    sections.push(formatToolEvents(args.toolEvents ?? []));
  }

  return sections.join('\n\n').trim();
}
