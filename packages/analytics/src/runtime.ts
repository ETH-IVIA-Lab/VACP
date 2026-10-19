import { provenanceActor, type VacpProvenanceRecord } from '@ethivia/vacp-protocol';
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
  if (entry.kind === 'turn')
    payload.turn = { activityId: entry.activityId, outcome: entry.outcome, opening: entry.opening };
  if (captureSnapshots && (entry.kind === 'action' || entry.kind === 'observation'))
    payload.observation = entry.observation;
  return payload;
}

const prefix = 'vacp';
const limit = 50;
const flushInterval = 1000;
const snapshotInterval = 1000;

export function installVacpRuntimeAnalytics(args: InstallVacpRuntimeAnalyticsArgs): VacpRuntimeAnalyticsInstallation {
  const { bridge, provider, captureSnapshots = false, getBaseProperties } = args;
  bridge.signal.throwIfAborted();
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
      base = getBaseProperties?.() ?? {};
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
    if (disposed || !provider.setSessionProperties || flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      // The runtime journal owns retention and resets. Telemetry owns only delivery pacing.
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
    if (disposed) return;
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
  safe(() => provider.startSessionRecording?.());
  safe(() =>
    provider.capture(`${prefix}_runtime_init`, {
      ...properties(),
      historyLength: bridge.getProvenance().records.length,
    }),
  );
  scheduleFlush();

  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    clearTimeout(flushTimer);
    clearPendingSnapshot();
    bridge.signal.removeEventListener('abort', dispose);
  }
  bridge.signal.addEventListener('abort', dispose, { once: true });
  if (bridge.signal.aborted) dispose();
  return { dispose };
}
