import { sameVacpValue, type VacpGraph } from '@vacp/protocol';
import type { VacpCapabilitiesSnapshot, VacpResolvedObservation, VacpStateSnapshot } from '@vacp/protocol';
import type { VacpLiveSnapshots } from './types';
import { notify } from './helpers';

type LiveRead = VacpLiveSnapshots & VacpResolvedObservation;

/** Owns coherent live reads and invalidation; never selects or restores history. */
export function createLiveObservations(read: () => Promise<VacpResolvedObservation>, signal: AbortSignal) {
  const capabilityListeners = new Set<(snapshot: VacpCapabilitiesSnapshot) => void>();
  const snapshotListeners = new Set<(snapshots: VacpLiveSnapshots) => void>();
  let snapshotKey: string | undefined;
  let graph: VacpGraph | undefined;
  let observationGeneration = 0;
  let pendingRead: { generation: number; promise: Promise<LiveRead> } | undefined;
  const readLive = async (generation: number): Promise<LiveRead> => {
    signal.throwIfAborted();
    if (generation !== observationGeneration) return ensureLive();
    let resolved: VacpResolvedObservation;
    try {
      resolved = await read();
    } catch (error) {
      signal.throwIfAborted();
      if (generation !== observationGeneration) return ensureLive();
      throw error;
    }
    signal.throwIfAborted();
    if (generation !== observationGeneration) return ensureLive();
    const { observation } = resolved;
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

    if (capabilityListeners.size > 0 || snapshotListeners.size > 0) {
      // Most reads change state only. Source descriptions can change without a new revision, so the
      // whole graph is compared, in one pass and without serializing it.
      const graphChanged = !graph || !sameVacpValue(graph, cap.graph);
      if (graphChanged) {
        graph = cap.graph;
        notify(capabilityListeners, cap);
      }
      if (snapshotListeners.size > 0) {
        const stateKey = observation.revision;
        if (graphChanged || stateKey !== snapshotKey) {
          snapshotKey = stateKey;
          notify(snapshotListeners, { observation, capabilities: cap, state: st });
        }
      }
    }
    return { ...resolved, capabilities: cap, state: st };
  };

  const ensureLive = (): Promise<LiveRead> => {
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
    get subscribed() {
      return capabilityListeners.size > 0 || snapshotListeners.size > 0;
    },
    invalidate() {
      observationGeneration++;
    },
    reset() {
      observationGeneration++;
      snapshotKey = undefined;
      graph = undefined;
    },
    subscribeCapabilities(this: void, listener: (snapshot: VacpCapabilitiesSnapshot) => void) {
      signal.throwIfAborted();
      capabilityListeners.add(listener);
      return () => {
        capabilityListeners.delete(listener);
      };
    },
    subscribeSnapshots(this: void, listener: (snapshots: VacpLiveSnapshots) => void) {
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
      pendingRead = undefined;
      snapshotKey = undefined;
      graph = undefined;
    },
  };
}
