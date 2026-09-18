import fs from 'node:fs/promises';
import path from 'node:path';
import type { OpencodeMessageInfo, OpencodePart } from './opencode-export.js';

export type WriteJobTranscriptArgs = {
  runID: string;
  runDir: string;
  jobDirAbs: string;
  sessionID: string;
  messages: OpencodeMessageInfo[];
  partsByMessageID: Map<string, OpencodePart[]>;
};

export type WriteJobTranscriptResult = {
  transcriptPath: string;
  status: 'ok' | 'missing_session_id' | 'no_messages';
};

export type RenderSessionTranscriptMarkdownArgs = {
  runID: string;
  jobDirRelative: string;
  sessionID: string;
  messages: OpencodeMessageInfo[];
  partsByMessageID: Map<string, OpencodePart[]>;
};

const EXCLUDED_KEY_SEGMENTS = new Set(
  [
    'id',
    'sessionid',
    'messageid',
    'callid',
    'projectid',
    'itemid',
    'filepath',
    'path',
    'url',
    'mime',
    'cwd',
    'root',
    'handleref',
    'snapshot',
    'attachment',
    'attachments',
    'reasoningencryptedcontent',
    'thoughtsignature',
  ].map((k) => k.toLowerCase()),
);

export async function writeJobTranscript(args: WriteJobTranscriptArgs): Promise<WriteJobTranscriptResult> {
  const transcriptPath = path.join(args.jobDirAbs, 'transcript.md');
  const sessionID = args.sessionID.trim();
  const jobDirRelative = path.relative(args.runDir, args.jobDirAbs) || args.jobDirAbs;

  if (!sessionID) {
    const markdown = renderStatusTranscriptMarkdown({
      runID: args.runID,
      jobDirRelative,
      sessionID: '',
      status: 'missing_session_id',
      detail: 'run.json does not contain a sessionID for this job.',
    });

    await writeTranscript(transcriptPath, markdown);

    return { transcriptPath, status: 'missing_session_id' };
  }

  if (!args.messages.length) {
    const markdown = renderStatusTranscriptMarkdown({
      runID: args.runID,
      jobDirRelative,
      sessionID,
      status: 'no_messages',
      detail: 'No OpenCode messages were found in the per-job export for this session.',
    });

    await writeTranscript(transcriptPath, markdown);

    return { transcriptPath, status: 'no_messages' };
  }

  const markdown = renderSessionTranscriptMarkdown({
    runID: args.runID,
    jobDirRelative,
    sessionID,
    messages: args.messages,
    partsByMessageID: args.partsByMessageID,
  });

  await writeTranscript(transcriptPath, markdown);

  return { transcriptPath, status: 'ok' };
}

export function renderSessionTranscriptMarkdown(args: RenderSessionTranscriptMarkdownArgs) {
  const lines: string[] = [];

  lines.push(`# Transcript: ${args.runID} / ${args.sessionID}`);
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- run_id: \`${args.runID}\``);
  lines.push(`- session_id: \`${args.sessionID}\``);
  lines.push(`- job_dir: \`${args.jobDirRelative}\``);
  lines.push(`- message_count: \`${args.messages.length}\``);
  lines.push('');
  lines.push('## Messages');
  lines.push('');

  args.messages.forEach((message, index) => {
    const role = message.role || 'unknown';
    const ordinal = String(index + 1).padStart(3, '0');

    lines.push(`## Message ${ordinal} (${role})`);
    lines.push('');

    const created = toIso(message.timeCreated);
    const completed = toIso(message.timeCompleted);
    lines.push(`- created: \`${created ?? ''}\``);
    lines.push(`- completed: \`${completed ?? ''}\``);
    lines.push('');

    if (typeof message.errorMessage === 'string' && message.errorMessage.trim()) {
      pushTextBlock(lines, '### Assistant Error', message.errorMessage);
      lines.push('');
    }

    const parts = args.partsByMessageID.get(message.id) ?? [];
    let emitted = 0;

    for (const part of parts) {
      emitted += appendPart(lines, part);
    }

    if (emitted === 0) {
      lines.push('_No textual parts._');
      lines.push('');
    }
  });

  return lines.join('\n').trimEnd() + '\n';
}

function renderStatusTranscriptMarkdown(args: {
  runID: string;
  jobDirRelative: string;
  sessionID: string;
  status: 'missing_session_id' | 'no_messages';
  detail: string;
}) {
  const lines: string[] = [];
  lines.push('# Transcript');
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- run_id: \`${args.runID}\``);
  lines.push(`- session_id: \`${args.sessionID || '(missing)'}\``);
  lines.push(`- job_dir: \`${args.jobDirRelative}\``);
  lines.push(`- status: \`${args.status}\``);
  lines.push('');
  lines.push('## Note');
  lines.push('');
  lines.push(args.detail);
  lines.push('');

  return lines.join('\n').trimEnd() + '\n';
}

function appendPart(lines: string[], part: OpencodePart) {
  if (part.type === 'text') {
    const text = normalizeText(part.text);

    if (!text) return 0;
    pushTextBlock(lines, '### Text', text);
    lines.push('');

    return 1;
  }

  if (part.type === 'reasoning') {
    const text = normalizeText(part.text);

    if (!text) return 0;
    pushTextBlock(lines, '### Reasoning', text);
    lines.push('');

    return 1;
  }

  if (part.type === 'step-finish') {
    const reason = normalizeText(part.reason);

    if (!reason) return 0;
    lines.push('### Step Finish');
    lines.push('');
    lines.push(`- reason: \`${reason}\``);
    lines.push('');

    return 1;
  }

  if (part.type !== 'tool') return 0;

  const tool = typeof part.tool === 'string' && part.tool.trim() ? part.tool.trim() : 'unknown';
  const state = part.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : {};
  const status = normalizeText(state.status);

  lines.push(`### Tool: \`${tool}\``);
  lines.push('');

  if (status) lines.push(`- status: \`${status}\``);
  lines.push('');

  const title = normalizeText(state.title);

  if (title) {
    pushTextBlock(lines, '#### Title', title);
    lines.push('');
  }

  const inputTexts = collectTextLeaves(state.input, ['input']);

  for (const inputText of inputTexts) {
    pushTextBlock(lines, `#### Input \`${inputText.path}\``, inputText.value);
    lines.push('');
  }

  const output = normalizeText(state.output);

  if (output) {
    pushTextBlock(lines, '#### Output', output);
    lines.push('');
  }

  const error = normalizeText(state.error);

  if (error) {
    pushTextBlock(lines, '#### Error', error);
    lines.push('');
  }

  return 1;
}

function collectTextLeaves(value: unknown, pathSegments: string[]): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [];
  visitTextLeaves(value, pathSegments, out);

  return out;
}

function visitTextLeaves(value: unknown, pathSegments: string[], out: Array<{ path: string; value: string }>) {
  if (typeof value === 'string') {
    if (pathIsExcluded(pathSegments)) return;
    const text = normalizeText(value);

    if (!text) return;
    out.push({ path: pathSegments.join('.'), value: text });

    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      visitTextLeaves(value[i], pathSegments.concat(String(i)), out);
    }

    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    visitTextLeaves(v, pathSegments.concat(k), out);
  }
}

function pathIsExcluded(pathSegments: string[]) {
  for (const seg of pathSegments) {
    if (/^\d+$/.test(seg)) continue;
    const normalized = seg.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!normalized) continue;

    if (EXCLUDED_KEY_SEGMENTS.has(normalized)) return true;

    if (normalized.includes('encrypted')) return true;

    if (normalized.includes('signature')) return true;
  }

  return false;
}

function pushTextBlock(lines: string[], heading: string, rawText: string) {
  const text = normalizeText(rawText);

  if (!text) return;
  const fence = fenceFor(text);
  lines.push(heading);
  lines.push('');
  lines.push(`${fence}text`);
  lines.push(text);
  lines.push(fence);
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return '';
  const noAnsi = stripAnsi(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return noAnsi.trim();
}

const ESC = String.fromCharCode(0x1b);

const BEL = String.fromCharCode(0x07);

const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

const ANSI_OSC_BEL_RE = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g');

const ANSI_OSC_ST_RE = new RegExp(`${ESC}\\][^${ESC}]*${ESC}\\\\`, 'g');

function stripAnsi(value: string) {
  return value.replace(ANSI_CSI_RE, '').replace(ANSI_OSC_BEL_RE, '').replace(ANSI_OSC_ST_RE, '');
}

function fenceFor(text: string) {
  let maxRun = 0;
  const matches = text.match(/`+/g) ?? [];

  for (const m of matches) {
    if (m.length > maxRun) maxRun = m.length;
  }

  return '`'.repeat(Math.max(3, maxRun + 1));
}

function toIso(epochMs?: number) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);

  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

async function writeTranscript(filePath: string, markdown: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
}
