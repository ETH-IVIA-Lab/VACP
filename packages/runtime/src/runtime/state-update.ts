import { matchesRefScope } from './ref-scope';
import type {
  VacpStateDeltaPayload,
  VacpRef,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/protocol';
import { VACP_SCHEMA_VERSION, fnv1a64Hex, stableStringify } from '@vacp/protocol';

function scopeValues(values: Record<VacpRef, unknown>, scope: ReadonlySet<string>): Record<VacpRef, unknown> {
  const scoped: Record<VacpRef, unknown> = {};
  for (const [ref, value] of Object.entries(values) as [VacpRef, unknown][])
    if (matchesRefScope(ref, scope)) scoped[ref] = value;
  return scoped;
}

/** The request's refs and summary choice applied to a full snapshot, so full and delta reads share one view. */
export function scopeStateSnapshot(
  snapshot: VacpStateSnapshot,
  request: VacpStateRequest,
): { snapshot: VacpStateSnapshot; refs?: VacpRef[] } {
  const refs = request.refs?.length ? [...new Set(request.refs)].sort() : undefined;
  const summary = request.includeSummary === false ? undefined : snapshot.summary;
  if (!refs) return { snapshot: { ...snapshot, summary } };
  const scope = new Set<string>(refs);
  const scopedSummary = summary && scopeValues(summary, scope);
  return {
    snapshot: {
      ...snapshot,
      state: scopeValues(snapshot.state, scope),
      summary: scopedSummary && Object.keys(scopedSummary).length ? scopedSummary : undefined,
    },
    refs,
  };
}

/**
 * A content token for a scoped snapshot. JSON leaves out undefined values, so the sorted ref lists
 * tell a ref holding undefined from an absent one.
 */
function stateToken({ state, summary }: VacpStateSnapshot): string {
  const payload = {
    state,
    stateRefs: Object.keys(state).sort(),
    summary,
    summaryRefs: summary ? Object.keys(summary).sort() : undefined,
  };
  return `st_${fnv1a64Hex(stableStringify(payload))}`;
}

function diff(
  baseline: Record<VacpRef, unknown> = {},
  current: Record<VacpRef, unknown> = {},
): { changed: Record<VacpRef, unknown>; removed: VacpRef[] } {
  const changed: Record<VacpRef, unknown> = {};
  for (const [ref, value] of Object.entries(current) as [VacpRef, unknown][])
    if (!Object.hasOwn(baseline, ref) || stableStringify(baseline[ref]) !== stableStringify(value))
      changed[ref] = value;
  const removed = (Object.keys(baseline) as VacpRef[]).filter((ref) => !Object.hasOwn(current, ref)).sort();
  return { changed, removed };
}

const unchanged = (): VacpStateDeltaPayload => ({
  changed: {},
  removed: [],
  summaryChanged: undefined,
  summaryRemoved: undefined,
});

function changes(baseline: VacpStateSnapshot, current: VacpStateSnapshot): VacpStateDeltaPayload {
  const state = diff(baseline.state, current.state);
  const summary = diff(baseline.summary, current.summary);
  return {
    ...state,
    summaryChanged: Object.keys(summary.changed).length ? summary.changed : undefined,
    summaryRemoved: summary.removed.length ? summary.removed : undefined,
  };
}

/** The full scoped state when `baseline` is unknown, else the changes since it. */
export function buildStateUpdate(args: {
  current: VacpStateSnapshot;
  request: VacpStateRequest;
  baseline?: VacpStateSnapshot;
}): { update: VacpStateUpdate; snapshot: VacpStateSnapshot } {
  const { snapshot, refs } = scopeStateSnapshot(args.current, args.request);
  const token = stateToken(snapshot);
  const envelope = {
    version: VACP_SCHEMA_VERSION,
    createdAt: snapshot.createdAt,
    token,
    ...(refs && { scope: { refs } }),
  };
  if (!args.request.since || !args.baseline) return { update: { ...envelope, mode: 'full', snapshot }, snapshot };

  // Tokens identify values and ref membership, so a matching token is an empty delta.
  const delta =
    token === args.request.since
      ? unchanged()
      : changes(scopeStateSnapshot(args.baseline, args.request).snapshot, snapshot);
  return { update: { ...envelope, mode: 'delta', baseToken: args.request.since, delta }, snapshot };
}
