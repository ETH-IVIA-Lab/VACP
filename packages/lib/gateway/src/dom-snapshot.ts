import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

export type VacpDomSnapshotSource = {
  getCapabilities: () => VacpCapabilitiesSnapshot | Promise<VacpCapabilitiesSnapshot>;
  getState: () => VacpStateSnapshot | Promise<VacpStateSnapshot>;
};

function hasDocument(): boolean {
  return typeof document !== 'undefined' && !!document && typeof document.getElementById === 'function';
}

function sanitizeDomId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_:-]/g, '_');
}

export function defaultVacpDomSnapshotScriptId(globalKey: string): string {
  const key = typeof globalKey === 'string' && globalKey.length ? globalKey : '__vacp';
  return sanitizeDomId(`${key}_snapshot`);
}

function safeJsonForScriptTag(value: unknown): string {
  // Prevent `</script>` from terminating the tag while keeping valid JSON.
  // This is still "pure JSON" (uses JSON unicode escapes).
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function ensureSnapshotScript(id: string): HTMLScriptElement | null {
  if (!hasDocument()) return null;
  const existing = document.getElementById(id);
  if (existing && existing.tagName === 'SCRIPT') return existing as HTMLScriptElement;

  const script = document.createElement('script');
  script.id = id;
  script.type = 'application/json';
  script.setAttribute('data-vacp', 'snapshot');
  (document.head ?? document.body ?? document.documentElement).appendChild(script);
  return script;
}

export function removeVacpDomSnapshotScript(scriptId: string): void {
  if (!hasDocument()) return;
  const existing = document.getElementById(scriptId);
  if (existing && existing.tagName === 'SCRIPT') existing.remove();
}

export async function updateVacpDomSnapshotScript(args: {
  source: VacpDomSnapshotSource;
  scriptId: string;
}): Promise<void> {
  const script = ensureSnapshotScript(args.scriptId);
  if (!script) return;

  try {
    const [capabilities, state] = await Promise.all([args.source.getCapabilities(), args.source.getState()]);
    script.textContent = safeJsonForScriptTag({ version: VACP_SCHEMA_VERSION, capabilities, state });
  } catch {
    // Never break the host app if snapshots are temporarily unavailable.
  }
}

export function writeVacpDomSnapshotScript(args: {
  scriptId: string;
  capabilities: VacpCapabilitiesSnapshot;
  state: VacpStateSnapshot;
}): void {
  const script = ensureSnapshotScript(args.scriptId);
  if (!script) return;
  script.textContent = safeJsonForScriptTag({
    version: VACP_SCHEMA_VERSION,
    capabilities: args.capabilities,
    state: args.state,
  });
}
