import type {
  VacpExecutionSource,
  VacpObservation,
  VacpRestore,
  VacpProvenanceSource,
  VacpTurnRecord,
} from '@ethivia/vacp-protocol';
import type { ProvenanceCheckpoint } from './checkpoints';

/**
 * A viewer's replay state, with stable identity while nothing in it changes. Outside `live`, `steps`
 * and `turns` stay frozen at the moment review began, so the reviewed request cannot shift under the
 * person. `selected` names the checkpoint being restored from the moment it is asked for.
 */
export type ProvenanceReplayState = {
  steps: readonly ProvenanceCheckpoint[];
  /** Finished agent turns in the current session, oldest first. Their steps share `activityId`. */
  turns: readonly VacpTurnRecord[];
  selected: ProvenanceCheckpoint | null;
  /** Another actor's execution is prepared and its record is not yet in `steps`. Review waits for it. */
  working: boolean;
  /** Latest original checkpoint, before the viewer's filter. */
  latest: ProvenanceCheckpoint | null;
} & ({ phase: 'error'; error: string } | { phase: 'live' | 'restoring' | 'reviewing' });
export type ProvenanceReplaySource = VacpProvenanceSource &
  VacpExecutionSource & {
    inspect(): Promise<VacpObservation>;
  };
export type ProvenanceReplayOptions = {
  restore: VacpRestore;
};
export interface ProvenanceReplayController {
  getState(): ProvenanceReplayState;
  subscribe(listener: () => void): () => void;
  review(checkpointId: string): Promise<void>;
  close(): Promise<void>;
  /** Host input intent abandons replay without restoring its saved baseline. */
  interrupt(): void;
  dispose(): void;
}
