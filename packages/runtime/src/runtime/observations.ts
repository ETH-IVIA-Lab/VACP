import { stableStringify } from '@vacp/protocol';
import type { VacpCapabilitiesSnapshot, VacpObservation, VacpStateSnapshot } from '@vacp/protocol';
import type { VacpLiveSnapshots } from './types';
import { notify } from './helpers';

/** Owns coherent live reads and invalidation; never selects or restores history. */
export function createLiveObservations(read: () => Promise<VacpObservation>, signal: AbortSignal) {
  const capabilityListeners = new Set<(snapshot: VacpCapabilitiesSnapshot) => void>();
  const snapshotListeners = new Set<(snapshots: VacpLiveSnapshots) => void>();
  let snapshotKey: string | undefined;
  let capabilitiesKey: string | undefined;
  let observationGeneration = 0;
  let pendingRead: { generation: number; promise: Promise<VacpLiveSnapshots> } | undefined;
  let current: VacpLiveSnapshots | undefined;
  const readLive = async (generation: number): Promise<VacpLiveSnapshots> => {
    signal.throwIfAborted();
    if (generation !== observationGeneration) return ensureLive();
    let observation: VacpObservation;
    try {
      observation = await read();
    } catch (error) {
      signal.throwIfAborted();
      if (generation !== observationGeneration) return ensureLive();
      throw error;
    }
    signal.throwIfAborted();
    if (generation !== observationGeneration) return ensureLive();
    const cap: VacpCapabilitiesSnapshot = {
      version: observation.version,
      createdAt: observation.observedAt,
      graph: observation.graph,
    };
    const st: VacpStateSnapshot = {
      version: observation.version,
      createdAt: observation.observedAt,
      state: observation.state,
      summary: observation.summary,
    };
    current = { observation, capabilities: cap, state: st };

    if (capabilityListeners.size > 0 || snapshotListeners.size > 0) {
      const nextKey = stableStringify(cap.graph);
      const graphChanged = capabilitiesKey !== nextKey;
      capabilitiesKey = nextKey;
      if (graphChanged) notify(capabilityListeners, cap);
      if (snapshotListeners.size > 0) {
        const stateKey = observation.revision;
        if (graphChanged || stateKey !== snapshotKey) {
          snapshotKey = stateKey;
          notify(snapshotListeners, { observation, capabilities: cap, state: st });
        }
      }
    }
    return { observation, capabilities: cap, state: st };
  };

  const ensureLive = (): Promise<VacpLiveSnapshots> => {
    signal.throwIfAborted();
    if (pendingRead?.generation === observationGeneration) return pendingRead.promise;
    const generation = observationGeneration;
    const request = {
      generation,
      promise: Promise.resolve().then(() => readLive(generation)),
    };
    pendingRead = request;
    void request.promise
      .finally(() => {
        if (pendingRead === request) pendingRead = undefined;
      })
      .catch(() => {});
    return request.promise;
  };

  return {
    read: ensureLive,
    get current() {
      return current;
    },
    get subscribed() {
      return capabilityListeners.size > 0 || snapshotListeners.size > 0;
    },
    invalidate() {
      observationGeneration++;
    },
    reset() {
      observationGeneration++;
      current = undefined;
      snapshotKey = undefined;
      capabilitiesKey = undefined;
    },
    subscribeCapabilities(listener: (snapshot: VacpCapabilitiesSnapshot) => void) {
      signal.throwIfAborted();
      capabilityListeners.add(listener);
      return () => {
        capabilityListeners.delete(listener);
      };
    },
    subscribeSnapshots(listener: (snapshots: VacpLiveSnapshots) => void) {
      signal.throwIfAborted();
      snapshotListeners.add(listener);
      snapshotKey = undefined;
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    dispose() {
      capabilityListeners.clear();
      snapshotListeners.clear();
      current = undefined;
    },
  };
}
