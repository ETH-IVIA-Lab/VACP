import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createJiti } from 'jiti';
import type { Dirent } from 'node:fs';
import { JsonArrayWriter } from './json-array.js';
import {
  readMessageParts,
  readSessionMessages,
  relPathFromStorage,
  resolveOpencodeStorageRoot,
  type OpencodeMessageInfo,
} from './opencode-storage.js';
import { classifyEvalOutcome, detectPlumbingFailure } from '../eval/outcome.js';
import { parseAnswerFromText, parseStructuredReflectionFromText } from './score.js';

export type AnalyzeRunArgs = {
  runDir: string;
  outDir?: string;
  configPath?: string;
  opencodeRoot?: string;
  maxFieldChars?: number;
};

export async function analyzeArenaRun(args: AnalyzeRunArgs) {
  const runDir = path.resolve(args.runDir);
  const outDir = path.resolve(args.outDir ?? path.join(runDir, 'analysis'));

  await assertIsDirectory(runDir);

  const maxFieldChars =
    Number.isFinite(args.maxFieldChars) && (args.maxFieldChars as number) > 0 ? (args.maxFieldChars as number) : 500;

  const contextPath = path.join(runDir, 'context.json');

  const context = ((await readJsonOptional(contextPath, 'run context.json')) as any) ?? {};
  const uiBase = typeof context?.uiBase === 'string' ? String(context.uiBase) : undefined;

  const jobDirs = await findJobDirs(runDir);
  if (jobDirs.length === 0) {
    throw new Error(`No job folders found under ${path.join(runDir, 'runs')} (expected runs/**/input.json).`);
  }

  const sessionIDs = await collectSessionIDs(jobDirs);
  const storage = await resolveOpencodeStorageRoot({ opencodeRoot: args.opencodeRoot, sessionIDs });

  const scoring = await loadScenarioJudges(args.configPath);
  const configHash = scoring?.configHash ?? null;
  const scenariosPath = scoring?.scenariosPath ?? null;
  const scenariosHash = scoring?.scenariosHash ?? null;
  const judgeByScenarioId = scoring?.judges ?? new Map<string, unknown>();

  const runId = path.basename(runDir);

  const metaPath = path.join(outDir, 'meta.json');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runDir,
        runId,
        opencodeStorageDir: storage.storageDir,
        uiBase: uiBase ?? null,
        configPath: scoring?.configPath ?? null,
        configSha256: configHash,
        scenariosPath,
        scenariosSha256: scenariosHash,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const runsJsonPath = path.join(outDir, 'runs.json');
  const toolCallsJsonPath = path.join(outDir, 'tool_calls.json');

  const runsJson = new JsonArrayWriter(runsJsonPath);
  const toolCallsJson = new JsonArrayWriter(toolCallsJsonPath);

  const allJobRows: any[] = [];

  for (const jobDirAbs of jobDirs) {
    const inputPath = path.join(jobDirAbs, 'input.json');
    const runPath = path.join(jobDirAbs, 'run.json');

    const input = (await readJsonOrThrow(inputPath, `input.json (${jobDirAbs})`)) as any;
    const run = ((await readJsonOptional(runPath, `run.json (${jobDirAbs})`)) as any) ?? {};

    const experiment = String(input?.experiment ?? '');
    const scenarioId = String(input?.scenario?.id ?? '');
    const scenarioUrl = String(input?.scenario?.url ?? '');
    const modelProvider = String(input?.model?.providerID ?? '');
    const modelName = String(input?.model?.modelID ?? '');

    const ok = Boolean(run?.ok);
    const runErrorMessage = typeof run?.error?.message === 'string' ? String(run.error.message) : null;
    const projectID = typeof run?.projectID === 'string' ? String(run.projectID) : '';
    const sessionID = typeof run?.sessionID === 'string' ? String(run.sessionID) : '';
    const uiUrl = uiBase && sessionID ? `${uiBase}/session/${sessionID}` : '';

    const startedAt = typeof run?.startedAt === 'string' ? String(run.startedAt) : '';
    const finishedAt = typeof run?.finishedAt === 'string' ? String(run.finishedAt) : '';
    const durationMs = computeDurationMs({ startedAt, finishedAt });

    const screenshotStats = await computeScreenshotStats(jobDirAbs);

    const sessionMessages = sessionID ? await readSessionMessages(storage, sessionID) : [];
    const sessionMetrics = computeSessionMetrics(sessionMessages);

    const toolCalls = sessionID ? await extractToolCalls(storage, sessionMessages, maxFieldChars) : [];
    const toolSummary = summarizeToolCalls(toolCalls);

    const answerCandidate = sessionID ? await findBestAnswer(storage, sessionMessages) : null;
    const parsed = answerCandidate?.text
      ? parseAnswerFromText(answerCandidate.text)
      : { parseStatus: 'no_final_assistant' as const, answerJson: null as null };
    const structuredReflection = answerCandidate?.text
      ? parseStructuredReflectionFromText(answerCandidate.text)
      : { parseStatus: 'no_final_assistant' as const, reflection: null as null };

    const judge = judgeByScenarioId.get(scenarioId);
    const score = await evaluateScenario({
      judge,
      scenarioId,
      parseStatus: parsed.parseStatus,
      answer: parsed.answerJson,
      answerJsonRaw: parsed.answerJsonRaw,
    });

    const hasHttps = toolCalls.some((t) => t.hasHttps === true);
    const hasReadEnoent = toolCalls.some(
      (t) => t.tool === 'read' && t.status === 'error' && /ENOENT|no such file/i.test(t.errorPreview ?? ''),
    );
    const hasErrConnRefused = toolCalls.some(
      (t) =>
        /ERR_CONNECTION_REFUSED/.test(t.outputPreview ?? '') || /ERR_CONNECTION_REFUSED/.test(t.errorPreview ?? ''),
    );
    const hasChromeWebdata = toolCalls.some(
      (t) =>
        /chrome-error:\/\/chromewebdata/.test(t.outputPreview ?? '') ||
        /chrome-error:\/\/chromewebdata/.test(t.errorPreview ?? ''),
    );

    const plumbingFailure = detectPlumbingFailure({
      ok,
      runErrorMessage,
      hasErrConnectionRefused: hasErrConnRefused,
      hasChromeWebdata,
    });
    const plumbingOk = plumbingFailure === null;
    const evalOutcome = classifyEvalOutcome({
      plumbingOk,
      parseStatus: parsed.parseStatus,
      hasJudge: typeof judge === 'function',
      solvedStrict: score.solvedStrict,
      solvedSemantic: score.solvedSemantic,
    });

    const row = {
      run_id: runId,
      experiment,
      scenario_id: scenarioId,
      scenario_url: scenarioUrl,
      model_provider: modelProvider,
      model_name: modelName,
      ok,
      run_error_message: clampField(runErrorMessage, maxFieldChars),
      project_id: projectID,
      session_id: sessionID,
      ui_url: uiUrl,
      job_dir: path.relative(runDir, jobDirAbs) || jobDirAbs,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
      opencode_start_ms: sessionMetrics.startMs,
      opencode_end_ms: sessionMetrics.endMs,
      opencode_duration_ms: sessionMetrics.durationMs,
      cost: sessionMetrics.cost,
      tokens_input: sessionMetrics.tokensInput,
      tokens_output: sessionMetrics.tokensOutput,
      tokens_reasoning: sessionMetrics.tokensReasoning,
      tokens_cache_read: sessionMetrics.tokensCacheRead,
      tokens_cache_write: sessionMetrics.tokensCacheWrite,
      tokens_total_no_cache: sessionMetrics.tokensTotalNoCache,
      tokens_total_with_cache: sessionMetrics.tokensTotalWithCache,
      messages_total: sessionMetrics.messagesTotal,
      messages_user: sessionMetrics.userMessages,
      messages_assistant: sessionMetrics.assistantMessages,
      tool_calls: toolSummary.toolCalls,
      tool_errors: toolSummary.toolErrors,
      tool_timed_calls: toolSummary.toolTimedCalls,
      tool_duration_ms: toolSummary.toolDurationMs,
      tools_json: toolSummary.toolsJson,
      screenshots_count: screenshotStats.count,
      screenshots_bytes: screenshotStats.totalBytes,
      answer_message_id: answerCandidate?.messageID ?? '',
      answer_parse_status: parsed.parseStatus,
      answer_json: parsed.answerJson,
      answer_json_raw: parsed.answerJsonRaw ?? '',
      reflection_structured_parse_status: structuredReflection.parseStatus,
      reflection_structured_json: structuredReflection.reflection,
      reflection_structured_raw: structuredReflection.reflectionRaw ?? '',
      reflection_provenance: structuredReflection.reflection?.provenance ?? null,
      reflection_confidence: structuredReflection.reflection?.confidence ?? null,
      reflection_robustness: structuredReflection.reflection?.processRobustness ?? null,
      reflection_easy_hard_why: structuredReflection.reflection?.easyHardWhy ?? null,
      reflection_actions_tools_available_vs_used_why:
        structuredReflection.reflection?.actionsToolsAvailableVsUsedWhy ?? null,
      score_ok: score.ok,
      score_label: score.label,
      score_json: score.result,
      solved_strict: score.solvedStrict,
      solved_semantic: score.solvedSemantic,
      plumbing_ok: plumbingOk,
      plumbing_failure: plumbingFailure,
      eval_outcome: evalOutcome,
      has_https_tool_calls: hasHttps,
      has_read_enoent: hasReadEnoent,
      has_err_connection_refused: hasErrConnRefused,
      has_chrome_webdata: hasChromeWebdata,
    };

    allJobRows.push(row);
    runsJson.writeRow(row);

    for (const t of toolCalls) {
      const toolRow = {
        run_id: runId,
        experiment,
        scenario_id: scenarioId,
        model_provider: modelProvider,
        model_name: modelName,
        project_id: projectID,
        session_id: sessionID,
        ui_url: uiUrl,
        message_id: t.messageID,
        part_id: t.partID,
        call_id: t.callID,
        tool: t.tool,
        status: t.status,
        time_start_ms: t.timeStartMs,
        time_end_ms: t.timeEndMs,
        duration_ms: t.durationMs,
        bash_command: t.bashCommand,
        read_file_path: t.readFilePath,
        vacp_action_name: t.vacpActionName,
        has_https: t.hasHttps,
        input_json: t.inputJson,
        output_preview: t.outputPreview,
        output_len: t.outputLen,
        error_preview: t.errorPreview,
        error_len: t.errorLen,
        storage_part_path: t.storagePartPath,
      };
      toolCallsJson.writeRow(toolRow);
    }
  }

  await Promise.all([runsJson.close(), toolCallsJson.close()]);

  return {
    runId,
    outDir,
    runsJsonPath,
    toolCallsJsonPath,
    metaPath,
    rows: allJobRows,
  };
}

type ScenarioScore = {
  ok: boolean | null;
  label: string;
  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;
  result: unknown | null;
};

async function evaluateScenario(args: {
  judge: unknown;
  scenarioId: string;
  parseStatus: string;
  answer: unknown | null;
  answerJsonRaw?: string;
}): Promise<ScenarioScore> {
  const defaultFailed: ScenarioScore = {
    ok: false,
    label: 'parse_error',
    solvedStrict: null,
    solvedSemantic: null,
    result: { ok: false, label: 'parse_error', notes: [args.parseStatus] },
  };

  if (args.parseStatus !== 'ok') return defaultFailed;

  if (typeof args.judge !== 'function') {
    return {
      ok: null,
      label: '',
      solvedStrict: null,
      solvedSemantic: null,
      result: null,
    };
  }

  let res: any;
  try {
    res = await (args.judge as any)({
      scenarioId: args.scenarioId,
      answer: args.answer,
      parseStatus: args.parseStatus,
      ...(typeof args.answerJsonRaw === 'string' ? { answerJsonRaw: args.answerJsonRaw } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      label: 'judge_error',
      solvedStrict: null,
      solvedSemantic: null,
      result: { ok: false, label: 'judge_error', error: message },
    };
  }

  if (!res || typeof res !== 'object') {
    return {
      ok: false,
      label: 'invalid_judge_result',
      solvedStrict: null,
      solvedSemantic: null,
      result: { ok: false, label: 'invalid_judge_result' },
    };
  }

  const ok = typeof res.ok === 'boolean' ? res.ok : null;
  const label = typeof res.label === 'string' ? res.label : '';

  const strict = (res as any).strictOk ?? (res as any).solvedStrict;
  const semantic = (res as any).semanticOk ?? (res as any).solvedSemantic;
  const solvedStrict = typeof strict === 'boolean' ? strict : ok;
  const solvedSemantic = typeof semantic === 'boolean' ? semantic : ok;

  return { ok, label, solvedStrict, solvedSemantic, result: res };
}

async function collectSessionIDs(jobDirsAbs: string[]) {
  const out: string[] = [];
  for (const jobDirAbs of jobDirsAbs) {
    const runPath = path.join(jobDirAbs, 'run.json');
    const run = (await readJsonOptional(runPath, `run.json (${jobDirAbs})`)) as any;
    const sessionID = typeof run?.sessionID === 'string' ? String(run.sessionID) : '';
    if (sessionID) out.push(sessionID);
  }
  return Array.from(new Set(out));
}

async function findJobDirs(runDir: string) {
  const runsRoot = path.join(runDir, 'runs');
  const inputs = await findFiles(runsRoot, 'input.json');
  return inputs.map((p) => path.dirname(p));
}

async function findFiles(root: string, fileName: string) {
  const out: string[] = [];
  await walk(root, async (p, ent) => {
    if (ent.isFile() && ent.name === fileName) out.push(p);
  });
  return out;
}

async function walk(root: string, onEntry: (fullPath: string, ent: Dirent) => Promise<void>) {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    await onEntry(full, ent);
    if (ent.isDirectory()) await walk(full, onEntry);
  }
}

async function readJsonOrThrow(filePath: string, label: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${filePath}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readJsonOptional(filePath: string, label: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') return null;
    throw new Error(`Failed to read ${label}: ${filePath}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertIsDirectory(p: string) {
  try {
    const st = await fs.stat(p);
    if (!st.isDirectory()) throw new Error('Not a directory');
  } catch {
    throw new Error(`Run directory does not exist or is not a directory: ${p}`);
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function computeDurationMs(args: { startedAt?: string; finishedAt?: string }) {
  if (!args.startedAt || !args.finishedAt) return null;
  const s = Date.parse(args.startedAt);
  const e = Date.parse(args.finishedAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.max(0, e - s);
}

async function computeScreenshotStats(jobDirAbs: string) {
  const entries = await safeReaddir(jobDirAbs);
  const shots = entries.filter((e) => e.isFile() && /^step-\d+\.(png|jpg|jpeg)$/i.test(e.name));
  let totalBytes = 0;
  for (const s of shots) {
    try {
      const st = await fs.stat(path.join(jobDirAbs, s.name));
      totalBytes += st.size;
    } catch {
      // ignore
    }
  }
  return { count: shots.length, totalBytes };
}

async function safeReaddir(p: string) {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

function computeSessionMetrics(messages: OpencodeMessageInfo[]) {
  let cost = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensReasoning = 0;
  let tokensCacheRead = 0;
  let tokensCacheWrite = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  const createdTimes: number[] = [];
  const completedTimes: number[] = [];

  for (const m of messages) {
    if (typeof m.timeCreated === 'number') createdTimes.push(m.timeCreated);
    if (m.role === 'user') userMessages += 1;
    if (m.role === 'assistant') {
      assistantMessages += 1;
      if (typeof m.timeCompleted === 'number') completedTimes.push(m.timeCompleted);
      cost += typeof m.cost === 'number' ? m.cost : 0;
      tokensInput += typeof m.tokens?.input === 'number' ? m.tokens.input : 0;
      tokensOutput += typeof m.tokens?.output === 'number' ? m.tokens.output : 0;
      tokensReasoning += typeof m.tokens?.reasoning === 'number' ? m.tokens.reasoning : 0;
      tokensCacheRead += typeof m.tokens?.cache?.read === 'number' ? m.tokens.cache.read : 0;
      tokensCacheWrite += typeof m.tokens?.cache?.write === 'number' ? m.tokens.cache.write : 0;
    }
  }

  const startMs = createdTimes.length ? Math.min(...createdTimes) : null;
  const endMs = completedTimes.length
    ? Math.max(...completedTimes)
    : createdTimes.length
      ? Math.max(...createdTimes)
      : null;
  const durationMs = startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : null;

  const tokensTotalNoCache = tokensInput + tokensOutput + tokensReasoning;
  const tokensTotalWithCache = tokensTotalNoCache + tokensCacheRead;

  return {
    startMs,
    endMs,
    durationMs,
    cost,
    tokensInput,
    tokensOutput,
    tokensReasoning,
    tokensCacheRead,
    tokensCacheWrite,
    tokensTotalNoCache,
    tokensTotalWithCache,
    messagesTotal: messages.length,
    userMessages,
    assistantMessages,
  };
}

async function readAssistantMessageText(storage: { storageDir: string }, messageID: string) {
  const parts = await readMessageParts(storage, messageID);
  const texts = parts.filter((p) => p.type === 'text' && typeof p.text === 'string').map((p) => String(p.text));
  const combined = texts.join('\n').trim();
  return combined.length ? combined : null;
}

async function findBestAnswer(storage: { storageDir: string }, messages: OpencodeMessageInfo[]) {
  const candidates = messages.filter((m) => m.role === 'assistant');
  if (!candidates.length) return null;

  let best:
    | {
        score: number;
        timeCreated: number;
        messageID: string;
        text: string;
      }
    | undefined;

  for (const m of candidates) {
    const text = await readAssistantMessageText(storage, m.id);
    if (!text) continue;
    const parsed = parseAnswerFromText(text);
    if (parsed.parseStatus === 'no_text' || parsed.parseStatus === 'no_json_fence') continue;

    let score = 1;
    const trimmed = text.trim();
    if (/^final answer/i.test(trimmed)) score += 3;
    if (/^answer:/i.test(trimmed)) score += 4;
    if (/answer:\s*```json/i.test(text)) score += 10;
    if (/answer:\s*```/i.test(text)) score += 6;
    if (parsed.parseStatus === 'ok') score += 8;
    if (parsed.parseStatus === 'json_parse_error') score += 2;

    const timeCreated = typeof m.timeCreated === 'number' ? m.timeCreated : 0;
    if (!best || score > best.score || (score === best.score && timeCreated > best.timeCreated)) {
      best = { score, timeCreated, messageID: m.id, text };
    }
  }

  if (!best) return null;
  return { messageID: best.messageID, text: best.text };
}

type ToolCallRow = {
  messageID: string;
  partID: string;
  callID: string;
  tool: string;
  status: string;
  timeStartMs: number | null;
  timeEndMs: number | null;
  durationMs: number | null;
  bashCommand: string;
  readFilePath: string;
  vacpActionName: string;
  inputJson: string;
  outputPreview: string;
  outputLen: number;
  errorPreview: string;
  errorLen: number;
  storagePartPath: string;
  hasHttps: boolean;
};

async function extractToolCalls(
  storage: { storageDir: string },
  messages: OpencodeMessageInfo[],
  maxFieldChars: number,
): Promise<ToolCallRow[]> {
  const out: ToolCallRow[] = [];

  for (const m of messages) {
    const parts = await readMessageParts(storage, m.id);
    for (const p of parts) {
      if (p.type !== 'tool') continue;
      const tool = typeof p.tool === 'string' ? p.tool : '';
      const state = (p as any).state ?? {};
      const status = typeof state.status === 'string' ? String(state.status) : 'unknown';
      const callID = typeof (p as any).callID === 'string' ? String((p as any).callID) : '';
      const input = state.input ?? {};
      const output = typeof state.output === 'string' ? state.output : '';
      const error = typeof state.error === 'string' ? state.error : '';
      const timeStart = typeof state.time?.start === 'number' ? state.time.start : null;
      const timeEnd = typeof state.time?.end === 'number' ? state.time.end : null;
      const durationMs = timeStart !== null && timeEnd !== null ? Math.max(0, timeEnd - timeStart) : null;

      const bashCommand =
        tool === 'bash' && typeof input?.command === 'string'
          ? truncate(redactHomePath(input.command), maxFieldChars)
          : '';
      const readFilePath =
        tool === 'read' && typeof input?.filePath === 'string'
          ? truncate(redactHomePath(input.filePath), maxFieldChars)
          : '';
      const vacpActionName = typeof input?.name === 'string' ? String(input.name) : '';

      const inputSlim = redactAndTruncate(input, maxFieldChars);
      const inputJson = safeJsonString(inputSlim);

      const outputPreview = truncate(redactHomePath(output), maxFieldChars);
      const errorPreview = truncate(redactHomePath(error), maxFieldChars);

      const hasHttps = tool === 'bash' && /https:\/\//i.test(bashCommand);

      const partAbs = path.join(storage.storageDir, 'part', p.messageID, `${p.id}.json`);
      out.push({
        messageID: p.messageID,
        partID: p.id,
        callID,
        tool,
        status,
        timeStartMs: timeStart,
        timeEndMs: timeEnd,
        durationMs,
        bashCommand,
        readFilePath,
        vacpActionName,
        inputJson,
        outputPreview,
        outputLen: output.length,
        errorPreview,
        errorLen: error.length,
        storagePartPath: relPathFromStorage(storage as any, partAbs),
        hasHttps,
      });
    }
  }

  return out;
}

function summarizeToolCalls(calls: ToolCallRow[]) {
  let toolErrors = 0;
  let toolTimedCalls = 0;
  let toolDurationMs = 0;
  const tools: Record<string, { calls: number; errors: number; durationMs: number }> = {};

  for (const c of calls) {
    tools[c.tool] ??= { calls: 0, errors: 0, durationMs: 0 };
    tools[c.tool].calls += 1;
    if (c.status === 'error') {
      tools[c.tool].errors += 1;
      toolErrors += 1;
    }
    if (typeof c.durationMs === 'number') {
      tools[c.tool].durationMs += c.durationMs;
      toolTimedCalls += 1;
      toolDurationMs += c.durationMs;
    }
  }

  return {
    toolCalls: calls.length,
    toolErrors,
    toolTimedCalls,
    toolDurationMs,
    toolsJson: tools,
  };
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + '…';
}

function clampField(value: string | null, maxChars: number) {
  if (typeof value !== 'string') return null;
  return truncate(redactHomePath(value), maxChars);
}

function safeJsonString(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function redactAndTruncate(input: unknown, maxChars: number): unknown {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((v) => redactAndTruncate(v, maxChars));
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      // Sensitive-by-default: truncate long strings (commands, outputs, DOM snapshots, etc.)
      out[k] = truncate(redactHomePath(v), maxChars);
      continue;
    }
    if (typeof v === 'object' && v !== null) {
      out[k] = redactAndTruncate(v, maxChars);
      continue;
    }
    out[k] = v;
  }
  return out;
}

function redactHomePath(value: string) {
  const home = os.homedir();
  if (!home) return value;
  const escaped = escapeRegExp(home);
  const re = new RegExp(`${escaped}(?=[/\\\\]|$)`, 'g');
  return value.replace(re, '~');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadScenarioJudges(configPathRaw?: string) {
  const configPath = await resolveDefaultConfigPath(configPathRaw);
  if (!configPath) return null;

  const rawConfig = await readFileOptional(configPath);
  if (!rawConfig) return null;
  const configHash = crypto.createHash('sha256').update(rawConfig).digest('hex');

  const scenariosPath = path.join(path.dirname(configPath), 'agent-arena.scenarios.ts');
  const rawScenarios = await readFileOptional(scenariosPath);
  const scenariosHash = rawScenarios ? crypto.createHash('sha256').update(rawScenarios).digest('hex') : null;

  // Avoid any runtime preflight checks in the arena config during analysis.
  process.env.VACP_ARENA_SKIP_PREFLIGHT = '1';

  const jiti = createJiti(import.meta.url, { interopDefault: true });
  let mod: any;
  try {
    mod = await jiti.import(configPath);
  } catch {
    // Scoring is best-effort; allow analysis to proceed without solutions.
    return {
      configPath,
      configHash,
      scenariosPath: rawScenarios ? scenariosPath : null,
      scenariosHash,
      judges: new Map<string, unknown>(),
    };
  }

  const bases = (mod as any)?.SCENARIO_BASES;
  if (!Array.isArray(bases)) {
    return {
      configPath,
      configHash,
      scenariosPath: rawScenarios ? scenariosPath : null,
      scenariosHash,
      judges: new Map<string, unknown>(),
    };
  }

  const judges = new Map<string, unknown>();
  for (const s of bases) {
    if (!s || typeof s !== 'object') continue;
    const id = typeof (s as any).id === 'string' ? String((s as any).id) : '';
    if (!id) continue;
    const judge = (s as any).judge;
    if (typeof judge === 'function') judges.set(id, judge);
  }

  return { configPath, configHash, scenariosPath: rawScenarios ? scenariosPath : null, scenariosHash, judges };
}

async function resolveDefaultConfigPath(raw?: string) {
  if (raw?.trim()) return path.resolve(raw);

  const candidates = [
    path.resolve(process.cwd(), 'packages/agent-arena/agent-arena.config.ts'),
    path.resolve(process.cwd(), 'agent-arena.config.ts'),
  ];
  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isFile()) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

async function readFileOptional(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}
