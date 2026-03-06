import type { VacpRef, VacpStateRequest, VacpStateSnapshot, VacpStateUpdate } from '@vacp/core';
import { VACP_SCHEMA_VERSION, fnv1a64Hex, stableStringify } from '@vacp/core';

// Normalize and dedupe requested refs so token/delta output stays deterministic.
function normalizeRefs(refs: VacpRef[] | undefined): VacpRef[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const uniq = Array.from(new Set(refs.filter((x) => typeof x === 'string' && x.length > 0)));
  if (uniq.length === 0) return undefined;
  return uniq.sort() as VacpRef[];
}

function matchesScopedRef(ref: VacpRef, scopeRefs: VacpRef[]): boolean {
  return scopeRefs.some((scopeRef) => ref === scopeRef || ref.startsWith(`${scopeRef}/`));
}

// Apply request scope (`refs`, `includeSummary`) to a full snapshot.
// This keeps both full and delta paths operating on the exact same scoped view.
export function scopeStateSnapshot(
  snapshot: VacpStateSnapshot,
  request: VacpStateRequest,
): {
  snapshot: VacpStateSnapshot;
  refs?: VacpRef[];
} {
  const refs = normalizeRefs(request.refs);
  const includeSummary = request.includeSummary ?? true;

  if (!refs) {
    return {
      snapshot: {
        version: snapshot.version,
        createdAt: snapshot.createdAt,
        state: snapshot.state,
        summary: includeSummary ? snapshot.summary : undefined,
      },
    };
  }

  const state: Record<VacpRef, unknown> = {} as Record<VacpRef, unknown>;
  for (const [ref, value] of Object.entries(snapshot.state) as Array<[VacpRef, unknown]>) {
    if (matchesScopedRef(ref, refs)) {
      state[ref] = value;
    }
  }

  let summary: Record<VacpRef, unknown> | undefined;
  if (includeSummary && snapshot.summary) {
    summary = {} as Record<VacpRef, unknown>;
    for (const [ref, value] of Object.entries(snapshot.summary) as Array<[VacpRef, unknown]>) {
      if (matchesScopedRef(ref, refs)) {
        summary[ref] = value;
      }
    }
    if (Object.keys(summary).length === 0) summary = undefined;
  }

  return {
    snapshot: {
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      state,
      summary,
    },
    refs,
  };
}

// Compute a stable content token for a scoped snapshot.
// Equal scoped payloads always produce the same token.
export function computeStateToken(snapshot: VacpStateSnapshot): string {
  const payload: Record<string, unknown> = { state: snapshot.state };
  if (snapshot.summary) payload.summary = snapshot.summary;
  return `st_${fnv1a64Hex(stableStringify(payload))}`;
}

// Compute per-ref delta between two already-scoped snapshots.
// Comparison is structural (stable JSON), so caller ordering does not matter.
export function diffStateSnapshots(args: { baseline: VacpStateSnapshot; current: VacpStateSnapshot }): {
  changed: Record<VacpRef, unknown>;
  removed: VacpRef[];
  summaryChanged?: Record<VacpRef, unknown>;
  summaryRemoved?: VacpRef[];
} {
  const baseline = args.baseline;
  const current = args.current;

  const changed: Record<VacpRef, unknown> = {} as Record<VacpRef, unknown>;
  const removed: VacpRef[] = [];

  for (const [ref, value] of Object.entries(current.state) as Array<[VacpRef, unknown]>) {
    if (!Object.prototype.hasOwnProperty.call(baseline.state, ref)) {
      changed[ref] = value;
      continue;
    }
    const prev = baseline.state[ref];
    if (stableStringify(prev) !== stableStringify(value)) changed[ref] = value;
  }

  for (const ref of Object.keys(baseline.state) as VacpRef[]) {
    if (!Object.prototype.hasOwnProperty.call(current.state, ref)) removed.push(ref);
  }

  const currSummary = current.summary ?? ({} as Record<VacpRef, unknown>);
  const baseSummary = baseline.summary ?? ({} as Record<VacpRef, unknown>);
  const summaryChanged: Record<VacpRef, unknown> = {} as Record<VacpRef, unknown>;
  const summaryRemoved: VacpRef[] = [];

  for (const [ref, value] of Object.entries(currSummary) as Array<[VacpRef, unknown]>) {
    if (!Object.prototype.hasOwnProperty.call(baseSummary, ref)) {
      summaryChanged[ref] = value;
      continue;
    }
    const prev = baseSummary[ref];
    if (stableStringify(prev) !== stableStringify(value)) summaryChanged[ref] = value;
  }

  for (const ref of Object.keys(baseSummary) as VacpRef[]) {
    if (!Object.prototype.hasOwnProperty.call(currSummary, ref)) summaryRemoved.push(ref);
  }

  return {
    changed,
    removed: removed.sort(),
    summaryChanged: Object.keys(summaryChanged).length ? summaryChanged : undefined,
    summaryRemoved: summaryRemoved.length ? summaryRemoved.sort() : undefined,
  };
}

// Build the public `VacpStateUpdate` envelope.
// If `since` cannot be resolved (or mode forces full), this returns full snapshot mode.
export function buildStateUpdate(args: {
  current: VacpStateSnapshot;
  request: VacpStateRequest;
  baseline?: VacpStateSnapshot;
}): VacpStateUpdate {
  const mode = args.request.mode ?? 'auto';
  const { snapshot: scopedCurrent, refs } = scopeStateSnapshot(args.current, args.request);
  const token = computeStateToken(scopedCurrent);
  const scopedBaseline = args.baseline ? scopeStateSnapshot(args.baseline, args.request).snapshot : undefined;

  const useDelta = Boolean(args.request.since && scopedBaseline) && mode !== 'full';
  if (!useDelta) {
    return {
      version: VACP_SCHEMA_VERSION,
      createdAt: scopedCurrent.createdAt,
      mode: 'full',
      token,
      ...(refs ? { scope: { refs } } : {}),
      snapshot: scopedCurrent,
    };
  }

  const delta = diffStateSnapshots({ baseline: scopedBaseline as VacpStateSnapshot, current: scopedCurrent });
  return {
    version: VACP_SCHEMA_VERSION,
    createdAt: scopedCurrent.createdAt,
    mode: 'delta',
    token,
    baseToken: args.request.since as string,
    ...(refs ? { scope: { refs } } : {}),
    delta,
  };
}
