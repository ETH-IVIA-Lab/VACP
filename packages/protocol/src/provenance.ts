import type { VacpActor, VacpExecution, VacpFocus } from './execution';
import type { VacpActionCall, VacpActionExecutionOptions, VacpActionResult, VacpObservation } from './schema';

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
export type VacpProvenanceRecord = ProvenanceIdentity &
  (
    | {
        kind: 'action';
        execution: VacpTerminalExecution;
        call: VacpActionCall;
        result: VacpActionResult;
        /** Payload fields omitted because they could not be captured as recording data. */
        captureErrors?: readonly { field: 'result'; message: string }[];
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
         * An agent turn ended. `message` holds its closing sentence and `opening` its first one; the
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
export type VacpTurnRecord = Extract<VacpProvenanceRecord, { kind: 'turn' }>;

/** Runtime-owned retention; revisions order records within a session epoch. Records are immutable facts. */
export type VacpProvenanceSnapshot = {
  runtimeId: string;
  sessionKey?: string;
  epoch: number;
  revision: number;
  /** The most recent records retained; a consumer mirroring events applies the same bound. */
  limit: number;
  records: readonly VacpProvenanceRecord[];
};

export type VacpProvenanceEvent = {
  epoch: number;
  revision: number;
  /** A null record invalidates the previous epoch's recording. */
  record: VacpProvenanceRecord | null;
};

export interface VacpProvenanceSource {
  getProvenance(): VacpProvenanceSnapshot;
  subscribeProvenance(listener: (event: VacpProvenanceEvent) => void): () => void;
}
