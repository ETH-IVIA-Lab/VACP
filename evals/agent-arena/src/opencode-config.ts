import type { ArenaConfig } from './types.js';

const DEFAULT_MCP_TIMEOUT_MS = 120_000;

export function buildSpawnOpencodeConfig(config: ArenaConfig): Record<string, unknown> {
  const base = config.server?.opencodeConfig ?? {};

  const baseExperimental = isRecord(base.experimental) ? base.experimental : {};

  const mcpTimeout =
    typeof baseExperimental.mcp_timeout === 'number' && Number.isFinite(baseExperimental.mcp_timeout)
      ? baseExperimental.mcp_timeout
      : DEFAULT_MCP_TIMEOUT_MS;

  const experimental = { ...baseExperimental, mcp_timeout: mcpTimeout };

  const mcp = isRecord(base.mcp) ? base.mcp : {};

  return {
    ...base,
    experimental,
    ...(Object.keys(mcp).length > 0 ? { mcp } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
