import {
  sameVacpValue,
  type VacpProvenanceRecord,
  type VacpProvenanceSnapshot,
  type VacpRef,
} from '@ethivia/vacp-protocol';
import { effectful, isRestorationRecord } from './checkpoints';

/**
 * Who owns the captured value while the walk runs. No record owns an `unresolved` change yet, and a
 * record that captures the same transition takes it over. More than one record could have made a
 * `conflicted` change. Both read as `unknown`.
 */
type Owner = VacpProvenanceRecord | 'unchanged' | 'unresolved' | 'conflicted';

/** The ref's captured value, its owner, and the value the owner's change replaced. A baseline replaced nothing. */
type Captured = { value: unknown; owner: Owner; replaced?: { value: unknown } };

/** The owner of a change after `record` captured the same transition. */
function contest(owner: Owner, record: VacpProvenanceRecord): Owner {
  if (owner === 'unresolved') return record;
  if (typeof owner === 'string') return owner;
  if (owner.kind === 'observation') return 'conflicted';
  if (isRestorationRecord(record)) return owner;
  return isRestorationRecord(owner) ? record : 'conflicted';
}

/**
 * The retained record that set the current value of `state[ref]` in the current session. Records are
 * read oldest first, and each captured state is compared with the state captured before it:
 *
 * - An `external` observation owns a change from the previous captured state.
 * - An action that reached its effects, whether it succeeded, failed, or was cancelled, owns a change
 *   its own `before` and result show.
 * - Records that finish while an action runs precede it in the journal, so the journal does not show
 *   whether an action's `before` was captured before or after the current value. An action that ends on
 *   the current value takes it over only when no record owns it. When a record set the value, either
 *   could have made it, so the value is `unknown` until a record captures a different change.
 * - A change shown by a query or by an action rejected before its effects has no owner. It is `unknown`
 *   until an action that ends on it, or a restoration that captures the same transition, takes it over.
 *   A `before` that differs from the current captured value has unknown ownership, including when earlier
 *   records show the same transition.
 * - A restoration gives each value it restores back to the owner the ref had when it last held that
 *   value. A restoration that captures the same transition as another record contests only an
 *   observation's change, and an action owns a change it captures along with a restoration. Restorations
 *   capturing the same transition preserve earlier ownership when their `beforeCaptureId` matches. When no
 *   retained record held the value, the answer is one of the restoration's `vacp.apply_state` records, or
 *   `unknown` when the journal dropped records of the session.
 * - A `concurrent` observation is deferred to later listed execution records when every listed execution
 *   has a retained record and a later one captures the ref's value in its `before` or result. Intermediate
 *   values those records never capture enter history as `unknown`, including a value equal to the current
 *   one. While a listed execution has no retained record, the change the observation shows is `unknown`.
 *   When every listed record precedes the observation, it counts as `external`.
 * - An action that reached its effects without a captured result makes the next change an observation
 *   shows `unknown`, and every ref `unknown` while no capture follows it. An action without a captured
 *   result whose `before` shows another value than the current one does the same for that ref, and keeps
 *   the current value `unknown` until a capture shows a change. A turn is skipped. A session starts over.
 *
 * Returns `unchanged` when no record of the session set the ref's current value, counting the first
 * captured state of a session as its baseline. Returns `unknown` when no record owns the current value,
 * or when the change that set it may lie before the oldest retained record (`revision > records.length`).
 */
export function provenanceAttribution(
  journal: Pick<VacpProvenanceSnapshot, 'records' | 'revision'>,
  ref: VacpRef,
): VacpProvenanceRecord | 'unchanged' | 'unknown' {
  let complete = journal.revision <= journal.records.length;
  let current: Captured | undefined;
  // The values the ref held before `current`, oldest first, each with its owner when it was replaced.
  const earlier: { value: unknown; owner: Owner }[] = [];
  let unsettled = false;
  const recorded = new Map(
    journal.records.flatMap((record, index) =>
      record.kind === 'action' ? [[record.execution.id, index] as const] : [],
    ),
  );
  // A dropped record could have set the first value of an incomplete journal, so that baseline is conflicted.
  const baseline = (value: unknown): Captured => ({ value, owner: complete ? 'unchanged' : 'conflicted' });
  const resolve = (): Owner => {
    if (!current) return complete ? 'unchanged' : 'conflicted';
    const { value, owner } = current;
    if (typeof owner === 'string' || !isRestorationRecord(owner)) return owner;
    let index = earlier.length - 1;
    while (index >= 0 && !sameVacpValue(earlier[index]!.value, value)) index--;
    return index >= 0 ? earlier[index]!.owner : complete ? owner : 'conflicted';
  };
  const change = (value: unknown, owner: Owner, replaced: unknown) => {
    earlier.push({ value: current!.value, owner: resolve() });
    current = { value, owner, replaced: { value: replaced } };
  };
  for (const [index, record] of journal.records.entries()) {
    if (record.kind === 'session') {
      complete = true;
      current = undefined;
      earlier.length = 0;
      unsettled = false;
    } else if (record.kind === 'observation') {
      const { cause } = record;
      // A later execution record accounts for a value captured in its before or result. Other
      // intermediate values must enter history even when every listed execution has a record.
      const pending =
        cause.kind === 'concurrent'
          ? cause.executions
              .map(({ executionId }) => recorded.get(executionId))
              .filter((at) => at === undefined || at > index)
          : [];
      const value = record.observation.state[ref];
      if (
        pending.length &&
        !pending.includes(undefined) &&
        pending.some((at) => {
          const execution = journal.records[at!];
          return (
            execution?.kind === 'action' &&
            ((execution.before && sameVacpValue(execution.before.state[ref], value)) ||
              (execution.observation && sameVacpValue(execution.observation.state[ref], value)))
          );
        })
      )
        continue;
      if (!current) current = baseline(value);
      else if (!sameVacpValue(current.value, value))
        change(value, unsettled || pending.length ? 'conflicted' : record, current.value);
      else if (pending.length && !pending.includes(undefined)) current.owner = 'conflicted';
      unsettled = false;
    } else if (record.kind === 'action') {
      const shown = record.before?.state[ref];
      const value = record.observation?.state[ref];
      if (record.before && !current) {
        if (complete) current = baseline(shown);
      } else if (record.before && current && !sameVacpValue(current.value, shown)) {
        // The read identity proves both records used one before capture.
        const sharedCapture =
          isRestorationRecord(record) &&
          record.beforeCaptureId !== undefined &&
          typeof current.owner !== 'string' &&
          current.owner.kind === 'action' &&
          isRestorationRecord(current.owner) &&
          current.owner.beforeCaptureId === record.beforeCaptureId &&
          current.replaced &&
          sameVacpValue(current.replaced.value, shown) &&
          sameVacpValue(current.value, value);
        if (!record.observation || !(sameVacpValue(shown, value) || sharedCapture))
          earlier.push({ value: shown, owner: 'conflicted' });
        // With no result after it, the current value may have been replaced and set again since.
        if (!record.observation) {
          current.owner = 'conflicted';
          unsettled = true;
        }
      }
      if (!record.observation) {
        unsettled ||= effectful(record);
        continue;
      }
      unsettled = false;
      // The value the record started from. A record that did not reach its effects shows no change.
      const before = effectful(record) ? record.before.state[ref] : value;
      const own = !sameVacpValue(before, value);
      if (!current) current = baseline(value);
      else if (!sameVacpValue(current.value, value)) {
        change(value, own ? record : 'unresolved', own ? before : current.value);
        continue;
      }
      if (!own) continue;
      // The record ends on the current value. It captured the change that set it when it started from the
      // value that change replaced. A baseline is no change, unless dropped records could have made it.
      // Started from another value, it may have started before that change or after it, so it takes over
      // only a change no record owns.
      const { owner, replaced } = current;
      if (replaced ? sameVacpValue(before, replaced.value) : owner === 'conflicted')
        current.owner = contest(owner, record);
      else if (!isRestorationRecord(record))
        current = {
          ...current,
          owner: owner === 'unchanged' || owner === 'unresolved' ? record : 'conflicted',
          replaced: { value: before },
        };
    }
  }
  const owner = resolve();
  return unsettled || owner === 'unresolved' || owner === 'conflicted' ? 'unknown' : owner;
}
