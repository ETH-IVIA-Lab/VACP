import { lastPathComponent, type VacpRef, type VacpRuntimeSnapshot } from '@vacp/protocol';

export type VacpChatScopeMeta = {
  scopeId: string;
  label: string;
  runtimeId?: string;
  sessionKey?: string;
  viewRef?: VacpRef;
  vizRef?: VacpRef;
  urlKey: string;
  updatedAt: string;
};

function currentUrlKey(): string {
  if (typeof window === 'undefined') return 'about:blank';

  return `${window.location.origin}${window.location.pathname}${window.location.hash}`;
}

function firstRefByKind(runtime: VacpRuntimeSnapshot, kind: string): VacpRef | undefined {
  const nodes = runtime.currentCapabilities?.graph?.nodes ?? [];
  const node = nodes.find((entry) => entry.kind === kind);

  return node?.ref;
}

function labelFromRef(ref: VacpRef | undefined, fallback: string): string {
  if (!ref) return fallback;
  const withoutPrefix = ref.replace(/^vacp:\/\//, '');
  const name = lastPathComponent(withoutPrefix);

  return name && name.length ? name : withoutPrefix;
}

export function deriveVacpChatScope(runtime: VacpRuntimeSnapshot): VacpChatScopeMeta {
  const sessionKey = runtime.sessionKey?.trim() || undefined;
  const runtimeId = runtime.runtimeId?.trim() || undefined;
  const viewRef = firstRefByKind(runtime, 'View');
  const vizRef = firstRefByKind(runtime, 'Visualization');
  const urlKey = currentUrlKey();
  const updatedAt = new Date().toISOString();

  // Keep the scope stable for the active app/view URL even while capabilities
  // continue loading (view/viz refs can appear slightly later).
  if (runtimeId) {
    const labelRef = viewRef ?? vizRef;

    return {
      scopeId: `runtime:${runtimeId}:url:${urlKey}`,
      label: labelFromRef(labelRef, 'current view'),
      runtimeId,
      sessionKey,
      viewRef,
      vizRef,
      urlKey,
      updatedAt,
    };
  }

  if (sessionKey) {
    return {
      scopeId: `session:${sessionKey}`,
      label: `session:${sessionKey}`,
      runtimeId: runtime.runtimeId,
      sessionKey,
      viewRef,
      vizRef,
      urlKey,
      updatedAt,
    };
  }

  return {
    scopeId: `url:${urlKey}`,
    label: 'current view',
    runtimeId,
    viewRef,
    vizRef,
    urlKey,
    updatedAt,
  };
}
