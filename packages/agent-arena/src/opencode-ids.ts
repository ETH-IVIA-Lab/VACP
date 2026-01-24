export function sanitizeMcpSegment(value: string): string {
  // Must match OpenCode's MCP tool ID sanitization.
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function mcpToolId(serverName: string, toolName: string): string {
  return `${sanitizeMcpSegment(serverName)}_${sanitizeMcpSegment(toolName)}`;
}

export function mcpToolPattern(serverName: string): string {
  return `${sanitizeMcpSegment(serverName)}_*`;
}
