// Runner internals: higher-level helpers used by scenario/run execution.
// Arena semantics helpers own tool policy and human-facing logs.

import { consola } from 'consola';
import type { ArenaConfig, ArenaJob, PromptContext, ToolPolicy } from '../types.js';
import { sanitizeMcpSegment } from '../opencode-ids.js';

// --- Prompt/title templates --------------------------------------------

export function buildPrompt(config: ArenaConfig, ctx: PromptContext) {
  const tpl = ctx.job.promptTemplate ?? config.promptTemplate;
  if (!tpl) {
    throw new Error(`Missing promptTemplate (set config.promptTemplate or job.promptTemplate)`);
  }
  return tpl(ctx);
}

export function buildTitle(config: ArenaConfig, ctx: PromptContext) {
  const tpl = ctx.job.titleTemplate ?? config.titleTemplate;
  if (tpl) return tpl(ctx);

  const id = ctx.scenario.id ?? 'scenario';
  const q = ctx.scenario.task.replace(/\s+/g, ' ').trim();
  const short = q.length > 80 ? `${q.slice(0, 77)}...` : q;
  return `[agent-arena] ${ctx.job.experiment} · ${id} · ${short}`;
}

// --- Tool exposure policy ---------------------------------------------

export function computeTools(policy: ToolPolicy | undefined, job: ArenaJob) {
  if (!policy || policy.mode === 'all') return undefined;

  if (policy.mode === 'none') return { '*': false };

  const mcpAllow = expandMcpAllow(job.mcp);
  const normalized = normalizeToolSpecs(policy.ids);
  if (policy.mode === 'allow') {
    return orderedToolMap([
      { id: '*', enabled: false },
      ...normalized.map((id) => ({ id, enabled: true })),
      ...mcpAllow,
    ]);
  }

  // deny-list mode: only force-deny the listed tools/patterns (everything else follows normal permissions).
  return orderedToolMap([...normalized.map((id) => ({ id, enabled: false })), ...mcpAllow]);
}

function normalizeToolSpecs(ids: string[]) {
  return ids.map((raw) => normalizeToolSpec(raw)).filter((x) => x.length > 0);
}

function normalizeToolSpec(raw: string) {
  let value = raw.trim();
  if (!value) return '';

  // Support "functions.*" style names (OpenAI nomenclature); OpenCode tools are keyed by ID.
  if (value === 'functions.*') return '*';
  if (value.startsWith('functions.')) value = value.slice('functions.'.length);

  // OpenCode's edit/write/patch tools share the same permission gate ("edit").
  // If you deny/allow any of these tools, you must do it at the permission name.
  const lowered = value.toLowerCase();
  if (
    !value.includes('*') &&
    (lowered === 'edit' || lowered === 'write' || lowered === 'patch' || lowered === 'multiedit')
  ) {
    return 'edit';
  }

  return value;
}

function expandMcpAllow(mcp: ArenaJob['mcp']): Array<{ id: string; enabled: boolean }> {
  const servers = mcp?.servers ?? {};
  const allow = mcp?.allow ?? Object.keys(servers);
  if (!allow || allow.length === 0) return [];

  const serverKeys = Object.keys(servers);
  const serverKeyByLower = new Map(serverKeys.map((k) => [k.toLowerCase(), k] as const));

  return allow
    .map((item) => {
      const trimmed = item.trim();
      if (!trimmed) return { id: '', enabled: true };
      // Treat `foo_*` as a raw wildcard, otherwise interpret as an MCP server name.
      if (trimmed.includes('*')) return { id: trimmed, enabled: true };
      const resolvedServerKey = serverKeyByLower.get(trimmed.toLowerCase());
      const id = `${sanitizeMcpSegment(resolvedServerKey ?? trimmed)}_*`;
      return { id, enabled: true };
    })
    .filter((x) => x.id.length > 0);
}

function orderedToolMap(entries: Array<{ id: string; enabled: boolean }>) {
  const out: Record<string, boolean> = {};
  for (const e of entries) out[e.id] = e.enabled;
  return out;
}

// --- Human CLI logging -------------------------------------------------

export function logScenarioStarted(args: {
  experiment: string;
  scenario: { id: string; url: string };
  sessionID: string;
  projectID?: string;
  liveUrl?: string;
  outDir: string;
}) {
  consola.info(`▶ ${args.experiment} · ${args.scenario.id}`);
  consola.info(`  URL:  ${args.scenario.url}`);
  if (args.projectID) consola.info(`  Project: ${args.projectID}`);
  consola.info(`  Session: ${args.sessionID}`);
  if (args.liveUrl) consola.info(`  Live URL: ${args.liveUrl}`);
  consola.info(`  Out:  ${args.outDir}`);
}
