import { sanitizeMcpSegment } from '../opencode-ids.js';
import type { ArenaJob, ToolPolicy } from '../types.js';

export type McpServerAliases = Record<string, string>;

export function createLaneRuntimeJob(args: { job: ArenaJob; workerID: number }): {
  job: ArenaJob;
  serverAliases: McpServerAliases;
} {
  const servers = args.job.mcp?.servers;
  const serverNames = Object.keys(servers ?? {});

  if (serverNames.length === 0) {
    return {
      job: args.job,
      serverAliases: {},
    };
  }

  const serverAliases = Object.fromEntries(
    serverNames.map((name) => [name, laneServerName(name, args.workerID)] as const),
  );

  const remappedServers = Object.fromEntries(
    serverNames.map((name) => [serverAliases[name], (servers as Record<string, unknown>)[name]]),
  );

  return {
    job: {
      ...args.job,
      toolPolicy: remapToolPolicy(args.job.toolPolicy, serverAliases),
      mcp: {
        ...args.job.mcp,
        servers: remappedServers,
        allow: remapMcpAllow(args.job.mcp?.allow, serverAliases),
      },
    },
    serverAliases,
  };
}

export function rewritePromptForLane(prompt: string, serverAliases: McpServerAliases) {
  return rewriteMcpAwareString(prompt, serverAliases);
}

function laneServerName(serverName: string, workerID: number) {
  return `${serverName}__lane${workerID + 1}`;
}

function remapToolPolicy(policy: ToolPolicy | undefined, serverAliases: McpServerAliases): ToolPolicy | undefined {
  if (!policy) return policy;

  if (policy.mode !== 'allow' && policy.mode !== 'deny') return policy;

  return {
    ...policy,
    ids: policy.ids.map((id) => rewriteMcpAwareString(id, serverAliases)),
  };
}

function remapMcpAllow(allow: string[] | undefined, serverAliases: McpServerAliases): string[] | undefined {
  if (!allow) return undefined;
  const byLower = new Map(Object.entries(serverAliases).map(([name, alias]) => [name.toLowerCase(), alias] as const));

  return allow.map((entry) => {
    const trimmed = entry.trim();

    if (!trimmed) return entry;

    if (trimmed.includes('*')) return rewriteMcpAwareString(trimmed, serverAliases);
    const alias = byLower.get(trimmed.toLowerCase());

    return alias ?? entry;
  });
}

function rewriteMcpAwareString(value: string, serverAliases: McpServerAliases) {
  const mappings = Object.entries(serverAliases)
    .map(([serverName, laneName]) => ({
      from: `${sanitizeMcpSegment(serverName)}_`,
      to: `${sanitizeMcpSegment(laneName)}_`,
    }))
    .filter((entry) => entry.from !== entry.to)
    .sort((a, b) => b.from.length - a.from.length);

  if (mappings.length === 0) return value;

  let out = value;
  const placeholders: string[] = [];

  for (const [i, entry] of mappings.entries()) {
    const placeholder = `__VACP_MCP_ALIAS_${i}__`;
    placeholders.push(placeholder);
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escapeRegExp(entry.from)})`, 'g');
    out = out.replace(pattern, (_, lead: string) => `${lead}${placeholder}`);
  }

  for (const [i, entry] of mappings.entries()) {
    out = out.split(placeholders[i]).join(entry.to);
  }

  return out;
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
