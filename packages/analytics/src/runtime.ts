import type { VacpProvenanceRecord, VacpRuntimeBridge } from '@vacp/protocol';
import { provenanceActor } from '@vacp/provenance-core';
import type { InstallVacpRuntimeAnalyticsArgs, VacpRuntimeAnalyticsInstallation } from './types';

function entryToPayload(entry: VacpProvenanceRecord, captureSnapshots: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    message: entry.message,
    actor: provenanceActor(entry),
  };
  if (entry.kind === 'action') {
    payload.execution = entry.execution;
    payload.action = { name: entry.call.name, params: entry.call.params };
    payload.result = entry.result;
    if (entry.captureErrors) payload.captureErrors = entry.captureErrors;
    if (captureSnapshots) payload.before = entry.before;
  }
  if (captureSnapshots && entry.kind !== 'session') payload.observation = entry.observation;
  return payload;
}

const installations = new WeakMap<VacpRuntimeBridge, Map<string, VacpRuntimeAnalyticsInstallation>>();

export function installVacpRuntimeAnalytics(args: InstallVacpRuntimeAnalyticsArgs): VacpRuntimeAnalyticsInstallation {
  const { bridge, provider, options } = args;
  const prefix = options?.eventPrefix ?? 'vacp';
  const limit = Math.max(1, options?.historyLimit ?? 50);
  const flushInterval = Math.max(50, options?.sessionFlushIntervalMs ?? 1000);
  const captureSnapshots = options?.captureSnapshots ?? false;
  const snapshotInterval = Math.max(50, options?.snapshotCaptureIntervalMs ?? 1000);
  const key = `${provider.name}|${prefix}`;
  const registry = installations.get(bridge) ?? new Map<string, VacpRuntimeAnalyticsInstallation>();
  installations.set(bridge, registry);
  registry.get(key)?.cleanup();

  let disposed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSnapshot: VacpProvenanceRecord | undefined;
  let lastSnapshotAt = 0;
  const safe = (work: () => void) => {
    try {
      work();
    } catch {
      /* Telemetry never controls analytical execution. */
    }
  };
  const properties = () => {
    let base: Record<string, unknown> = {};
    safe(() => {
      base = options?.getBaseProperties?.() ?? {};
    });
    const snapshot = bridge.getProvenance();
    return {
      ...base,
      vacp_version: bridge.version,
      vacp_runtime_id: snapshot.runtimeId,
      vacp_session_key: snapshot.sessionKey,
    };
  };
  const scheduleFlush = () => {
    if (!provider.setSessionProperties || flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      // The runtime journal owns retention and resets; telemetry owns only delivery pacing.
      const records = bridge
        .getProvenance()
        .records.filter((entry) => captureSnapshots || entry.kind !== 'observation')
        .slice(-limit);
      safe(() =>
        provider.setSessionProperties?.({
          ...properties(),
          vacp_history: records.map((entry) => entryToPayload(entry, captureSnapshots)),
        }),
      );
    }, flushInterval);
  };
  const capture = (entry: VacpProvenanceRecord) => {
    safe(() =>
      provider.capture(`${prefix}_${entry.kind}`, { ...properties(), ...entryToPayload(entry, captureSnapshots) }),
    );
    scheduleFlush();
  };
  const clearPendingSnapshot = () => {
    clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
    pendingSnapshot = undefined;
    lastSnapshotAt = 0;
  };
  const unsubscribe = bridge.subscribeProvenance(({ record }) => {
    if (!record) {
      clearPendingSnapshot();
      scheduleFlush();
    } else if (record.kind !== 'observation') capture(record);
    else if (captureSnapshots) {
      const now = Date.now();
      const delay = Math.max(0, lastSnapshotAt + snapshotInterval - now);
      if (!delay && snapshotTimer === undefined) {
        lastSnapshotAt = now;
        capture(record);
      } else {
        pendingSnapshot = record;
        snapshotTimer ??= setTimeout(() => {
          snapshotTimer = undefined;
          const latest = pendingSnapshot;
          pendingSnapshot = undefined;
          lastSnapshotAt = Date.now();
          if (latest) capture(latest);
        }, delay);
      }
    }
  });
  if (options?.startSessionRecording ?? true) safe(() => provider.startSessionRecording?.());
  safe(() =>
    provider.capture(`${prefix}_runtime_init`, {
      ...properties(),
      historyLength: bridge.getProvenance().records.length,
    }),
  );
  scheduleFlush();

  const installation: VacpRuntimeAnalyticsInstallation = {
    cleanup() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      clearTimeout(flushTimer);
      clearPendingSnapshot();
      registry.delete(key);
    },
  };
  registry.set(key, installation);
  return installation;
}
