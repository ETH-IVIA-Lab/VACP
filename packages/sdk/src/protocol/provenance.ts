import type { VacpActionExecutionOptions, VacpActor, VacpExecution, VacpFocus } from './execution';
import type { VacpActionCall, VacpActionResult, VacpObservation, VacpRef } from './schema';

/** Only completed executions belong to the analytical recording. */
export type VacpTerminalExecution = Omit<VacpExecution, 'phase'> & {
  phase: 'succeeded' | 'failed' | 'cancelled';
};

export type VacpObservationCause =
  | { kind: 'external' }
  | {
      kind: 'concurrent';
      executions: readonly { executionId: string; restoration?: VacpActionExecutionOptions['restoration'] }[];
    };

type ProvenanceIdentity = { id: string; at: string; message?: string };

/** Captured facts. Observation checkpoints do not imply transaction isolation. */
export type ProvenanceRecord = ProvenanceIdentity &
  (
    | {
        kind: 'action';
        actor: VacpActor;
        execution: VacpTerminalExecution;
        call: VacpActionCall;
        result: VacpActionResult;
        /** Payload fields omitted because they could not be captured as recording data. */
        captureErrors?: readonly { field: 'result'; message: string }[];
        /**
         * Opaque identity of the runtime read used for `before`. Equal IDs prove the same capture,
         * including after serialization. Distinct reads have distinct IDs even when their values match.
         */
        beforeCaptureId?: string;
        before?: VacpObservation;
        observation?: VacpObservation;
      }
    | {
        kind: 'observation';
        cause: VacpObservationCause;
        actor: VacpActor;
        observation: VacpObservation;
        focus?: VacpFocus;
      }
    | { kind: 'session'; actor: VacpActor }
    | {
        /**
         * An agent turn ended. `message` holds its closing sentence and `opening` its first one. The
         * turn's steps carry the same `activityId` on their executions.
         */
        kind: 'turn';
        actor: VacpActor;
        activityId: string;
        outcome: 'completed' | 'failed' | 'cancelled';
        opening?: string;
      }
  );

/** The record of one finished agent turn: a request from its opening words to its conclusion. */
export type VacpTurnRecord = Extract<ProvenanceRecord, { kind: 'turn' }>;

/** Runtime-owned retention. Revisions order records within a session epoch. Records are immutable facts. */
export type VacpProvenanceSnapshot = {
  runtimeId: string;
  sessionKey?: string;
  epoch: number;
  /**
   * Records captured in this epoch, including dropped ones. `revision > records.length` means the
   * oldest `revision - records.length` records are no longer retained.
   */
  revision: number;
  /**
   * The most recent records retained. Past it, the oldest record is dropped. A consumer mirroring
   * events applies the same bound.
   */
  limit: number;
  records: readonly ProvenanceRecord[];
};

export type VacpProvenanceEvent = {
  epoch: number;
  revision: number;
  /** A null record invalidates the previous epoch's recording. */
  record: ProvenanceRecord | null;
};

export interface ProvenanceSource {
  getProvenance(): VacpProvenanceSnapshot;
  subscribeProvenance(listener: (event: VacpProvenanceEvent) => void): () => void;
}

export type VacpRestore = (
  state: Readonly<Record<VacpRef, unknown>>,
  options: VacpActionExecutionOptions,
) => Promise<VacpActionResult>;

export function provenanceFocus(record: ProvenanceRecord): VacpFocus | undefined {
  return record.kind === 'action'
    ? record.execution.intent?.focus
    : record.kind === 'observation'
      ? record.focus
      : undefined;
}

export function provenanceTurn(record: ProvenanceRecord): string | undefined {
  return record.kind === 'action'
    ? record.execution.activityId
    : record.kind === 'turn'
      ? record.activityId
      : undefined;
}
