import type { VacpHistoryEntry, VacpRuntimeBridge, VacpRuntimeSnapshot } from '@vacp/protocol';

import type {
  InstallVacpRuntimeAnalyticsArgs,
  VacpRuntimeAnalyticsInstallation,
  VacpRuntimeAnalyticsOptions,
} from './types.js';

type VacpRuntimeMeta = Readonly<{
  runtimeId?: string;
  sessionKey?: string;
}>;

function getRuntimeMeta(bridge: VacpRuntimeBridge, runtime: VacpRuntimeSnapshot | null): VacpRuntimeMeta {
  const runtimeId = runtime?.runtimeId ?? bridge.runtimeId;
  const sessionKey = runtime?.sessionKey ?? bridge.sessionKey;

  return { runtimeId, sessionKey };
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
  };

  if (entry.message) payload.message = entry.message;

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

const installations = new WeakMap<VacpRuntimeBridge, Map<string, VacpRuntimeAnalyticsInstallation>>();

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
  const registry = installations.get(bridge) ?? new Map<string, VacpRuntimeAnalyticsInstallation>();
  installations.set(bridge, registry);

  const existing = registry.get(installKey);

  if (existing) {
    existing.cleanup();
    registry.delete(installKey);
  }

  let disposed = false;
  let runtime: VacpRuntimeSnapshot | null = null;
  let unsubscribe: (() => void) | null = null;
  let flushTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

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

    const properties: Record<string, unknown> = {
      ...baseProps(args.options),
      vacp_version: bridge.version,
      vacp_history: historyBuffer.slice(-historyLimit),
    };

    if (meta.runtimeId) properties.vacp_runtime_id = meta.runtimeId;

    if (meta.sessionKey) properties.vacp_session_key = meta.sessionKey;

    safe(() => provider.setSessionProperties?.(properties));
  };

  const scheduleFlush = (): void => {
    if (!provider.setSessionProperties) return;

    if (flushTimer !== null) return;
    flushTimer = globalThis.setTimeout(() => {
      flushTimer = null;
      flushSession();
    }, flushIntervalMs);
  };

  const captureEntryNow = (entry: VacpHistoryEntry): void => {
    const payload = entryToPayload(entry, captureSnapshots);
    historyBuffer.push(payload);

    while (historyBuffer.length > historyLimit) historyBuffer.shift();

    const meta = getRuntimeMeta(bridge, runtime);
    const eventName = `${eventPrefix}_${entry.kind}`;

    const properties: Record<string, unknown> = {
      ...baseProps(args.options),
      vacp_version: bridge.version,
      ...payload,
    };

    if (meta.runtimeId) properties.vacp_runtime_id = meta.runtimeId;

    if (meta.sessionKey) properties.vacp_session_key = meta.sessionKey;

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
    );
  };

  if (shouldStartRecording) safe(() => provider.startSessionRecording?.());

  // Best-effort initial sync: seed session properties with the latest runtime + history.
  if (bridge.getRuntime) {
    Promise.resolve(bridge.getRuntime())
      .then((r) => {
        if (disposed) return;
        runtime = r;

        const initProps: Record<string, unknown> = {
          ...baseProps(args.options),
          vacp_version: bridge.version,
          observationRevision: r.observation.revision,
          historyLength: r.history.length,
        };

        if (r.runtimeId) initProps.vacp_runtime_id = r.runtimeId;

        if (r.sessionKey) initProps.vacp_session_key = r.sessionKey;

        safe(() => provider.capture(`${eventPrefix}_runtime_init`, initProps));

        takeLastHistoryEntries(r.history, historyLimit, captureSnapshots)
          .map((e) => entryToPayload(e, captureSnapshots))
          .forEach((p) => historyBuffer.push(p));

        while (historyBuffer.length > historyLimit) historyBuffer.shift();
        scheduleFlush();
      })
      .catch(() => {});
  }

  if (bridge.subscribe) {
    unsubscribe = bridge.subscribe((entry) => ingestEntry(entry));
  }

  const installation: VacpRuntimeAnalyticsInstallation = {
    cleanup: () => {
      if (disposed) return;
      disposed = true;

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
