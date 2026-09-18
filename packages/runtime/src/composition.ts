import { notify } from './runtime/helpers';
import {
  fnv1a64Hex,
  stableStringify,
  VACP_SCHEMA_VERSION,
  type VacpActionCall,
  type VacpActionExecutionOptions,
  type VacpActionResult,
  type VacpGraph,
  type VacpObservation,
  type VacpProvider,
  type VacpProviderObservation,
  type VacpRef,
  type VacpSourceId,
} from '@vacp/protocol';

const MAX_COHERENCE_RETRIES = 8;

function duplicate(kind: string, identity: string, first: VacpSourceId, second: VacpSourceId): never {
  throw new Error(`${kind} ${identity} is owned by both ${first} and ${second}`);
}

function ownValues(
  kind: string,
  sourceId: VacpSourceId,
  ownership: Record<VacpRef, VacpSourceId>,
  values: Record<VacpRef, unknown> | undefined,
): void {
  if (!values) return;
  for (const ref of Object.keys(values) as VacpRef[]) {
    const owner = ownership[ref];
    if (!owner) throw new Error(`${kind} ${ref} from ${sourceId} has no node in the composed graph`);
    if (owner !== sourceId) duplicate(kind, ref, owner, sourceId);
  }
}

function composeObservations(
  providers: readonly VacpProvider[],
  observations: readonly VacpProviderObservation[],
): VacpObservation {
  const nodes: VacpGraph['nodes'] = [];
  const edges: VacpGraph['edges'] = [];
  const actions: VacpGraph['actions'] = [];
  const ownership: VacpGraph['ownership'] = { nodes: {}, actions: {} };
  const state: Record<VacpRef, unknown> = {};
  const summary: Record<VacpRef, unknown> = {};
  const freshness: NonNullable<VacpObservation['freshness']> = {};
  const edgeKeys = new Set<string>();

  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index]!;
    const observation = observations[index]!;
    const sourceId = provider.source.id;
    if (observation.graph.version !== VACP_SCHEMA_VERSION) {
      throw new Error(`Source ${sourceId} published unsupported graph version ${observation.graph.version}`);
    }
    for (const node of observation.graph.nodes) {
      const owner = ownership.nodes[node.ref];
      if (owner) duplicate('Node', node.ref, owner, sourceId);
      ownership.nodes[node.ref] = sourceId;
      nodes.push(node);
    }
    for (const action of observation.graph.actions) {
      const owner = ownership.actions[action.name];
      if (owner) duplicate('Action', action.name, owner, sourceId);
      ownership.actions[action.name] = sourceId;
      actions.push(action);
    }
    for (const edge of observation.graph.edges) {
      const key = stableStringify(edge);
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(edge);
    }
  }

  const refs = new Set(nodes.map((node) => node.ref));
  for (const edge of edges) {
    if (!refs.has(edge.from) || !refs.has(edge.to)) {
      throw new Error(`Edge ${edge.from} -> ${edge.to} references a node missing from the composed graph`);
    }
  }

  for (const action of actions) {
    for (const ref of [...(action.operation.inputRefs ?? []), ...(action.operation.affects ?? [])]) {
      if (!refs.has(ref)) throw new Error(`Action ${action.name} references missing entity ${ref}`);
    }
  }

  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index]!;
    const observation = observations[index]!;
    ownValues('State', provider.source.id, ownership.nodes, observation.state);
    ownValues('Summary', provider.source.id, ownership.nodes, observation.summary);
    ownValues('Freshness', provider.source.id, ownership.nodes, observation.freshness);
    Object.assign(state, observation.state);
    Object.assign(summary, observation.summary);
    Object.assign(freshness, observation.freshness);
  }

  const graph: VacpGraph = {
    version: VACP_SCHEMA_VERSION,
    sources: providers.map((provider) => provider.source),
    ownership,
    nodes,
    edges,
    actions,
  };
  const revisionParts = providers.map((provider, index) => [provider.source.id, observations[index]!.revision]);
  const observedAt = observations.reduce(
    (latest, observation) => (observation.observedAt > latest ? observation.observedAt : latest),
    '',
  );
  return {
    version: VACP_SCHEMA_VERSION,
    revision: `obs_${fnv1a64Hex(stableStringify(revisionParts))}`,
    observedAt,
    graph,
    state,
    summary: Object.keys(summary).length ? summary : undefined,
    freshness: Object.keys(freshness).length ? freshness : undefined,
  };
}

/** Compose independently owned analytical sources into one coherent runtime port. */
export function composeVacpProviders(providers: readonly VacpProvider[]) {
  const bySource = new Map<VacpSourceId, VacpProvider>();
  for (const provider of providers) {
    const existing = bySource.get(provider.source.id);
    if (existing) throw new Error(`Duplicate VACP source: ${provider.source.id}`);
    bySource.set(provider.source.id, provider);
  }

  let epoch = 0;
  let disposed = false;
  const listeners = new Set<() => void>();
  const detach = providers.flatMap((provider) =>
    provider.subscribe
      ? [
          provider.subscribe(() => {
            epoch += 1;
            notify(listeners, undefined);
          }),
        ]
      : [],
  );

  const observe = async (): Promise<VacpObservation> => {
    if (disposed) throw new Error('VACP composition is disposed');
    for (let attempt = 0; attempt < MAX_COHERENCE_RETRIES; attempt++) {
      const before = epoch;
      const observations = await Promise.all(providers.map((provider) => provider.observe()));
      if (disposed) throw new Error('VACP composition is disposed');
      if (before !== epoch) continue;
      return composeObservations(providers, observations);
    }
    throw new Error('VACP sources did not settle into one coherent observation');
  };

  const execute = async (call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult> => {
    const observation = await observe();
    const sourceId = observation.graph.ownership.actions[call.name];
    if (!sourceId) return { callId: call.callId, ok: false, error: { message: `Unknown action: ${call.name}` } };
    return bySource.get(sourceId)!.execute(call, options);
  };

  return {
    observe,
    execute,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(options?: { providers?: boolean }) {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of detach) unsubscribe();
      if (options?.providers ?? true) {
        for (const provider of providers) provider.dispose?.();
      }
      listeners.clear();
    },
  };
}
