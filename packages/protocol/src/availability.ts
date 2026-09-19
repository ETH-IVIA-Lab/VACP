import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpAvailability,
  VacpNode,
  VacpObservation,
  VacpRef,
} from './schema';

export type VacpAvailabilityStatus = {
  readonly available: boolean;
  /** Direct unmet prerequisites. Follow their statuses to explain the dependency chain. */
  readonly blockedBy: readonly VacpRef[];
  readonly reason?: string;
};

export type VacpAvailabilityResolution = {
  readonly nodes: ReadonlyMap<VacpRef, VacpAvailabilityStatus>;
  readonly actions: ReadonlyMap<string, VacpAvailabilityStatus>;
};

export type VacpResolvedObservation<Data = Record<string, unknown>> = {
  readonly inspection: VacpObservation<Data>;
  readonly observation: VacpObservation<Data>;
  readonly availability: VacpAvailabilityResolution;
};

export type VacpAvailabilityFailure =
  | { code: 'unknown-action'; action: string }
  | { code: 'action-unavailable'; action: string; status: VacpAvailabilityStatus }
  | { code: 'input-unavailable'; action: string; ref: VacpRef; status?: VacpAvailabilityStatus };

/** Machine-readable eligibility failure, independent of an execution transport. */
export class VacpAvailabilityError extends Error {
  constructor(
    message: string,
    readonly details: VacpAvailabilityFailure,
  ) {
    super(message);
    this.name = 'VacpAvailabilityError';
  }
}

type AvailabilityGraph = {
  readonly nodes: readonly Pick<VacpNode, 'ref' | 'availability'>[];
  readonly actions: readonly Pick<VacpActionDescriptor, 'name' | 'availability'>[];
};

const AVAILABLE: VacpAvailabilityStatus = Object.freeze({
  available: true,
  blockedBy: Object.freeze([]),
  reason: undefined,
});

/** Resolve explicit prerequisites. Containment, inputs, and effects do not imply availability. */
export function resolveVacpAvailability(graph: AvailabilityGraph): VacpAvailabilityResolution {
  const nodes = new Map<VacpRef, VacpAvailabilityStatus>();
  const actions = new Map<string, VacpAvailabilityStatus>();
  const definitions = new Map<VacpRef, AvailabilityGraph['nodes'][number]>();
  for (const node of graph.nodes) {
    if (definitions.has(node.ref)) throw new Error(`Duplicate availability node ${node.ref}`);
    definitions.set(node.ref, node);
  }
  const dependents = new Map<VacpRef, VacpRef[]>();
  const remaining = new Map<VacpRef, number>();
  const ready: VacpRef[] = [];
  for (const node of graph.nodes) {
    const declared = node.availability?.requires;
    if (!declared?.length) {
      ready.push(node.ref);
      continue;
    }
    const requirements = new Set(declared);
    remaining.set(node.ref, requirements.size);
    for (const ref of requirements) {
      if (!definitions.has(ref)) throw new Error(`Missing prerequisite ${ref} for ${node.ref}`);
      const children = dependents.get(ref) ?? [];
      children.push(node.ref);
      dependents.set(ref, children);
    }
  }
  const status = (subject: string, availability?: VacpAvailability): VacpAvailabilityStatus => {
    const reason = availability?.unavailable;
    if (reason !== undefined && !reason.trim())
      throw new Error(`Availability for ${subject} requires a nonempty reason`);
    let blocked: Set<VacpRef> | undefined;
    for (const ref of availability?.requires ?? []) {
      const dependency = nodes.get(ref);
      if (!dependency) throw new Error(`Missing prerequisite ${ref} for ${subject}`);
      if (!dependency.available) (blocked ??= new Set()).add(ref);
    }
    if (reason === undefined && !blocked) return AVAILABLE;
    return Object.freeze({
      available: false,
      blockedBy: blocked ? Object.freeze([...blocked]) : AVAILABLE.blockedBy,
      reason,
    });
  };
  for (let index = 0; index < ready.length; index++) {
    const ref = ready[index]!;
    nodes.set(ref, status(ref, definitions.get(ref)!.availability));
    for (const child of dependents.get(ref) ?? []) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (count === 0) ready.push(child);
    }
  }
  if (nodes.size !== definitions.size) {
    const unresolved = [...definitions.keys()].filter((ref) => !nodes.has(ref));
    throw new Error(`Cyclic availability prerequisites; unresolved nodes: ${unresolved.join(', ')}`);
  }
  for (const action of graph.actions) {
    if (actions.has(action.name)) throw new Error(`Duplicate availability action ${action.name}`);
    actions.set(action.name, status(action.name, action.availability));
  }
  return { nodes, actions };
}

/** Project a complete observation into the currently reachable analytical surface. */
export function resolveVacpObservation<Data>(inspection: VacpObservation<Data>): VacpResolvedObservation<Data> {
  const availability = resolveVacpAvailability(inspection.graph);
  return { inspection, observation: disclose(inspection, availability), availability };
}

function disclose<Data>(
  observation: VacpObservation<Data>,
  availability: VacpAvailabilityResolution,
): VacpObservation<Data> {
  const nodes = observation.graph.nodes.filter((node) => availability.nodes.get(node.ref)!.available);
  const actions = observation.graph.actions.filter((action) => availability.actions.get(action.name)!.available);
  if (nodes.length === observation.graph.nodes.length && actions.length === observation.graph.actions.length)
    return observation;
  const refs = new Set(nodes.map((node) => node.ref));
  const select = <Value>(values: Record<VacpRef, Value>) =>
    Object.fromEntries(Object.entries(values).filter(([ref]) => refs.has(ref as VacpRef)));
  return {
    ...observation,
    graph: {
      ...observation.graph,
      nodes,
      actions,
      edges: observation.graph.edges.filter((edge) => refs.has(edge.from) && refs.has(edge.to)),
      ownership: {
        nodes: select(observation.graph.ownership.nodes),
        actions: Object.fromEntries(
          actions.map((action) => [action.name, observation.graph.ownership.actions[action.name]!]),
        ),
      },
    },
    state: select(observation.state),
    summary: observation.summary && select(observation.summary),
    freshness: observation.freshness && select(observation.freshness),
  };
}

/** Guard current eligibility using the same resolution as disclosure. */
export function assertVacpActionAvailable<Data>(resolved: VacpResolvedObservation<Data>, call: VacpActionCall): void {
  const action = resolved.inspection.graph.actions.find((candidate) => candidate.name === call.name);
  if (!action)
    throw new VacpAvailabilityError(`Unknown action: ${call.name}`, { code: 'unknown-action', action: call.name });
  const status = resolved.availability.actions.get(call.name)!;
  if (!status.available)
    throw new VacpAvailabilityError(
      `Action unavailable: ${call.name} (${status.reason ?? status.blockedBy.join(', ')})`,
      { code: 'action-unavailable', action: call.name, status },
    );
  if (!call.params || typeof call.params !== 'object') return;
  for (const { parameter, role } of action.operation.refParameters ?? []) {
    if (role !== 'input') continue;
    const ref: unknown = Object.getOwnPropertyDescriptor(call.params, parameter)?.value;
    if (typeof ref !== 'string') continue;
    const input = resolved.availability.nodes.get(ref as VacpRef);
    if (!input?.available)
      throw new VacpAvailabilityError(`Input unavailable: ${ref}`, {
        code: 'input-unavailable',
        action: call.name,
        ref: ref as VacpRef,
        status: input,
      });
  }
}
