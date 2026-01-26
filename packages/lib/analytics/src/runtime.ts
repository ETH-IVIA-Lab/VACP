import type { VacpHistoryEntry, VacpRuntimeBridge, VacpRuntimeSnapshot } from '@vacp/core';

import type {
  InstallVacpRuntimeAnalyticsArgs,
  VacpRuntimeAnalyticsInstallation,
  VacpRuntimeAnalyticsOptions,
} from './types';

type VacpRuntimeMeta = Readonly<{
  runtimeId?: string;
  sessionKey?: string;
}>;

function getRuntimeMeta(bridge: VacpRuntimeBridge, runtime: VacpRuntimeSnapshot | null): VacpRuntimeMeta {
  // Prefer the public `getRuntime()` snapshot, but fall back to gateway’s
  // internal fields for stability across view switches without polling.
  const runtimeId = runtime?.runtimeId ?? (bridge as VacpRuntimeBridge & { __vacpRuntimeId?: string }).__vacpRuntimeId;
  const sessionKey =
    runtime?.sessionKey ?? (bridge as VacpRuntimeBridge & { __vacpSessionKey?: string }).__vacpSessionKey;
  return {
    ...(runtimeId ? { runtimeId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  };
}

function baseProps(options?: VacpRuntimeAnalyticsOptions): Record<string, unknown> {
  try {
    return options?.getBaseProperties?.() ?? {};
  } catch {
    return {};
  }
}

function entryToPayload(entry: VacpHistoryEntry, captureSnapshots: boolean): Record<string, unknown> {
  // Keep payloads minimal and structured so analytics backends can store them.
  const payload: Record<string, unknown> = {
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    source: entry.source,
    ...(entry.message ? { message: entry.message } : {}),
  };

  if (entry.call) {
    payload.action = {
      name: entry.call.name,
      params: entry.call.params,
    };
  }
  if (entry.result) payload.result = entry.result;

  // Snapshot payloads can be high-frequency (brush interactions, animations).
  // Keep them opt-in to avoid spamming analytics by default.
  if (captureSnapshots) {
    if (entry.state) payload.state = entry.state;
    if (entry.beforeState) payload.beforeState = entry.beforeState;
    if (entry.afterState) payload.afterState = entry.afterState;
  }

  return payload;
}

function takeLastHistoryEntries(
  history: VacpHistoryEntry[],
  limit: number,
  captureSnapshots: boolean,
): VacpHistoryEntry[] {
  if (captureSnapshots) return history.slice(-limit);

  // When snapshots are disabled, avoid returning an empty list just because the
  // runtime observer produced a lot of `snapshot` entries recently.
  const out: VacpHistoryEntry[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const entry = history[i];
    if (entry.kind === 'snapshot') continue;
    out.push(entry);
  }
  return out.reverse();
}

export function installVacpRuntimeAnalytics(args: InstallVacpRuntimeAnalyticsArgs): VacpRuntimeAnalyticsInstallation {
  const provider = args.provider;
  const bridge = args.bridge;

  const eventPrefix = args.options?.eventPrefix ?? 'vacp';
  const historyLimit = Math.max(1, args.options?.historyLimit ?? 50);
  const flushIntervalMs = Math.max(50, args.options?.sessionFlushIntervalMs ?? 1_000);
  const captureSnapshots = args.options?.captureSnapshots ?? false;
  const snapshotCaptureIntervalMs = Math.max(50, args.options?.snapshotCaptureIntervalMs ?? 1_000);
  const shouldStartRecording = args.options?.startSessionRecording ?? true;

  // Idempotency: repeated installs (e.g. hot reload / view re-installs) replace
  // the previous subscription for the same provider+prefix.
  const installKey = `${provider.name}|${eventPrefix}`;
  const bridgeWithRegistry = bridge as VacpRuntimeBridge & {
    __vacpAnalyticsInstallations?: Map<string, VacpRuntimeAnalyticsInstallation>;
  };
  const registry =
    bridgeWithRegistry.__vacpAnalyticsInstallations ?? new Map<string, VacpRuntimeAnalyticsInstallation>();
  bridgeWithRegistry.__vacpAnalyticsInstallations = registry;

  const existing = registry.get(installKey);
  if (existing) {
    existing.cleanup();
    registry.delete(installKey);
  }

  let runtime: VacpRuntimeSnapshot | null = null;
  let unsubscribe: (() => void) | null = null;
  let flushTimer: number | null = null;
  let snapshotTimer: number | null = null;

  const historyBuffer: Array<Record<string, unknown>> = [];

  // Snapshot events can be very noisy (brush/drag). We keep the latest snapshot
  // and only send at most one per `snapshotCaptureIntervalMs`.
  let lastSnapshotCapturedAtMs = 0;
  let pendingSnapshot: VacpHistoryEntry | null = null;

  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      // Analytics must never break the host app.
    }
  };

  const flushSession = (): void => {
    if (!provider.setSessionProperties) return;

    const meta = getRuntimeMeta(bridge, runtime);
    const properties = {
      ...baseProps(args.options),
      vacp_version: bridge.version,
      ...(meta.runtimeId ? { vacp_runtime_id: meta.runtimeId } : {}),
      ...(meta.sessionKey ? { vacp_session_key: meta.sessionKey } : {}),
      vacp_history: historyBuffer.slice(-historyLimit),
    } as Record<string, unknown>;
    safe(() => provider.setSessionProperties?.(properties));
  };

  const scheduleFlush = (): void => {
    if (!provider.setSessionProperties) return;
    if (flushTimer !== null) return;
    flushTimer = globalThis.setTimeout(() => {
      flushTimer = null;
      flushSession();
    }, flushIntervalMs) as unknown as number;
  };

  const captureEntryNow = (entry: VacpHistoryEntry): void => {
    const payload = entryToPayload(entry, captureSnapshots);
    historyBuffer.push(payload);
    while (historyBuffer.length > historyLimit) historyBuffer.shift();

    const meta = getRuntimeMeta(bridge, runtime);
    const eventName = `${eventPrefix}_${entry.kind}`;
    const properties = {
      ...baseProps(args.options),
      vacp_version: bridge.version,
      ...(meta.runtimeId ? { vacp_runtime_id: meta.runtimeId } : {}),
      ...(meta.sessionKey ? { vacp_session_key: meta.sessionKey } : {}),
      ...payload,
    } as Record<string, unknown>;
    safe(() => provider.capture(eventName, properties));

    scheduleFlush();
  };

  const ingestEntry = (entry: VacpHistoryEntry): void => {
    if (entry.kind !== 'snapshot') {
      captureEntryNow(entry);
      return;
    }

    if (!captureSnapshots) return;

    const now = Date.now();
    const nextAllowedAt = lastSnapshotCapturedAtMs + snapshotCaptureIntervalMs;

    if (snapshotTimer === null && now >= nextAllowedAt) {
      lastSnapshotCapturedAtMs = now;
      captureEntryNow(entry);
      return;
    }

    pendingSnapshot = entry;

    if (snapshotTimer !== null) return;
    snapshotTimer = globalThis.setTimeout(
      () => {
        snapshotTimer = null;
        if (!pendingSnapshot) return;
        const next = pendingSnapshot;
        pendingSnapshot = null;
        lastSnapshotCapturedAtMs = Date.now();
        captureEntryNow(next);
      },
      Math.max(0, nextAllowedAt - now),
    ) as unknown as number;
  };

  if (shouldStartRecording) safe(() => provider.startSessionRecording?.());

  // Best-effort initial sync: seed session properties with the latest runtime + history.
  if (typeof bridge.getRuntime === 'function') {
    Promise.resolve(bridge.getRuntime())
      .then((r) => {
        runtime = r;
        const initProps = {
          ...baseProps(args.options),
          vacp_version: bridge.version,
          ...(r.runtimeId ? { vacp_runtime_id: r.runtimeId } : {}),
          ...(r.sessionKey ? { vacp_session_key: r.sessionKey } : {}),
          mode: r.mode,
          cursor: r.cursor,
          historyLength: r.history.length,
        } as Record<string, unknown>;
        safe(() => provider.capture(`${eventPrefix}_runtime_init`, initProps));

        takeLastHistoryEntries(r.history, historyLimit, captureSnapshots)
          .map((e) => entryToPayload(e, captureSnapshots))
          .forEach((p) => historyBuffer.push(p));
        while (historyBuffer.length > historyLimit) historyBuffer.shift();
        scheduleFlush();
      })
      .catch(() => {});
  }

  if (typeof bridge.subscribe === 'function') {
    unsubscribe = bridge.subscribe((entry) => ingestEntry(entry));
  }

  const installation: VacpRuntimeAnalyticsInstallation = {
    cleanup: () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
      unsubscribe = null;
      if (flushTimer !== null) {
        globalThis.clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (snapshotTimer !== null) {
        globalThis.clearTimeout(snapshotTimer);
        snapshotTimer = null;
      }
      pendingSnapshot = null;
      registry.delete(installKey);
    },
  };
  registry.set(installKey, installation);
  return installation;
}
