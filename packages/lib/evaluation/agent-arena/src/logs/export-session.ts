import fs from 'node:fs/promises';
import path from 'node:path';
import type { Message, OpencodeClient, Part, ToolPart } from '@opencode-ai/sdk/v2';
import { requireData } from '../runner/util.js';

export type SessionMetrics = {
  sessionID: string;
  uiUrl?: string;

  time: {
    startMs: number | null;
    endMs: number | null;
    durationMs: number | null;
  };

  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };

  counts: {
    messages: number;
    userMessages: number;
    assistantMessages: number;
    toolParts: number;
    toolErrors: number;
    toolTimedCalls: number;
    toolDurationMs: number;
  };

  tools: Record<
    string,
    {
      calls: number;
      errors: number;
      durationMs: number;
    }
  >;
};

export async function exportSessionLogs(args: {
  client: OpencodeClient;
  directory: string;
  sessionID: string;
  outDir: string;
  uiUrl?: string;
  limit?: number;
}) {
  const limit = Number.isFinite(args.limit) && (args.limit as number) > 0 ? (args.limit as number) : 5000;

  const res = await args.client.session.messages({ directory: args.directory, sessionID: args.sessionID, limit });
  const messages = requireData(res) as Array<{ info: Message; parts: Part[] }>;

  await fs.mkdir(args.outDir, { recursive: true });

  const assistantFinal = extractAssistantFinal(messages);

  const messagesPath = path.join(args.outDir, 'messages.json');
  await writeJson(messagesPath, messages);

  const toolCalls = extractToolCalls(messages);
  const toolCallsPath = path.join(args.outDir, 'tool_calls.json');
  await writeJson(toolCallsPath, toolCalls);

  const metrics = computeSessionMetrics({
    sessionID: args.sessionID,
    uiUrl: args.uiUrl,
    messages,
    toolCalls,
  });
  const metricsPath = path.join(args.outDir, 'metrics.json');
  await writeJson(metricsPath, metrics);

  const sessionPath = path.join(args.outDir, 'session.json');
  await writeJson(sessionPath, { sessionID: args.sessionID, uiUrl: args.uiUrl ?? null });

  return {
    messagesPath,
    toolCallsPath,
    metricsPath,
    sessionPath,
    metrics,
    assistantFinal,
  };
}

function extractToolCalls(messages: Array<{ info: Message; parts: Part[] }>) {
  const out: Array<{
    sessionID: string;
    messageID: string;
    partID: string;
    callID: string;
    tool: string;
    status: string;
    input: Record<string, unknown>;
    output?: string;
    error?: string;
    timeStart?: number;
    timeEnd?: number;
  }> = [];

  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== 'tool') continue;
      const tp = p as ToolPart;
      const state = tp.state as any;
      out.push({
        sessionID: tp.sessionID,
        messageID: tp.messageID,
        partID: tp.id,
        callID: tp.callID,
        tool: tp.tool,
        status: state?.status ?? 'unknown',
        input: (state?.input ?? {}) as Record<string, unknown>,
        ...(typeof state?.output === 'string' ? { output: state.output } : {}),
        ...(typeof state?.error === 'string' ? { error: state.error } : {}),
        ...(typeof state?.time?.start === 'number' ? { timeStart: state.time.start } : {}),
        ...(typeof state?.time?.end === 'number' ? { timeEnd: state.time.end } : {}),
      });
    }
  }
  return out;
}

function extractAssistantFinal(messages: Array<{ info: Message; parts: Part[] }>) {
  const assistant = messages.filter((m: any) => m?.info?.role === 'assistant').at(-1) as any;
  if (!assistant) return null;
  const text = (assistant.parts as any[])
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
  if (!text) return null;
  return { messageID: String(assistant.info?.id ?? ''), text };
}

function computeSessionMetrics(args: {
  sessionID: string;
  uiUrl?: string;
  messages: Array<{ info: Message; parts: Part[] }>;
  toolCalls: ReturnType<typeof extractToolCalls>;
}): SessionMetrics {
  const times: number[] = [];
  const endTimes: number[] = [];
  let cost = 0;

  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let userMessages = 0;
  let assistantMessages = 0;
  let toolParts = 0;

  for (const m of args.messages) {
    const info: any = m.info as any;
    if (typeof info?.time?.created === 'number') times.push(info.time.created);

    if (info?.role === 'user') userMessages += 1;
    if (info?.role === 'assistant') {
      assistantMessages += 1;
      if (typeof info?.time?.completed === 'number') endTimes.push(info.time.completed);
      cost += typeof info?.cost === 'number' ? info.cost : 0;
      tokens.input += typeof info?.tokens?.input === 'number' ? info.tokens.input : 0;
      tokens.output += typeof info?.tokens?.output === 'number' ? info.tokens.output : 0;
      tokens.reasoning += typeof info?.tokens?.reasoning === 'number' ? info.tokens.reasoning : 0;
      tokens.cacheRead += typeof info?.tokens?.cache?.read === 'number' ? info.tokens.cache.read : 0;
      tokens.cacheWrite += typeof info?.tokens?.cache?.write === 'number' ? info.tokens.cache.write : 0;
    }

    toolParts += m.parts.filter((p) => p.type === 'tool').length;
  }

  const toolErrors = args.toolCalls.filter((t) => t.status === 'error').length;
  const tools: SessionMetrics['tools'] = {};
  let toolTimedCalls = 0;
  let toolDurationMs = 0;
  for (const t of args.toolCalls) {
    const key = String(t.tool || 'unknown');
    tools[key] ??= { calls: 0, errors: 0, durationMs: 0 };
    tools[key].calls += 1;
    if (t.status === 'error') tools[key].errors += 1;
    if (typeof t.timeStart === 'number' && typeof t.timeEnd === 'number') {
      const dur = Math.max(0, t.timeEnd - t.timeStart);
      toolTimedCalls += 1;
      toolDurationMs += dur;
      tools[key].durationMs += dur;
    }
  }

  const startMs = times.length > 0 ? Math.min(...times) : null;
  const endMsRaw = endTimes.length > 0 ? Math.max(...endTimes) : times.length > 0 ? Math.max(...times) : null;
  const durationMs = startMs !== null && endMsRaw !== null ? Math.max(0, endMsRaw - startMs) : null;

  return {
    sessionID: args.sessionID,
    ...(args.uiUrl ? { uiUrl: args.uiUrl } : {}),
    time: { startMs, endMs: endMsRaw, durationMs },
    cost,
    tokens,
    counts: {
      messages: args.messages.length,
      userMessages,
      assistantMessages,
      toolParts,
      toolErrors,
      toolTimedCalls,
      toolDurationMs,
    },
    tools,
  };
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
