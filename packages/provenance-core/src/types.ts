import type {
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpExecutionSource,
  VacpObservation,
  VacpProvenanceSource,
  VacpTurnRecord,
} from '@vacp/protocol';
import type { ProvenanceCheckpoint } from './checkpoints';

/**
 * A viewer's replay state, with stable identity while nothing in it changes. Outside `live`, `steps`
 * and `turns` stay frozen at the moment review began, so the reviewed request cannot shift under the
 * person. `selected` names the checkpoint being restored from the moment it is asked for.
 */
export type ProvenanceReplayState = {
  phase: 'live' | 'restoring' | 'reviewing' | 'error';
  steps: readonly ProvenanceCheckpoint[];
  /** Finished agent turns in the current session, oldest first. Their steps share `activityId`. */
  turns: readonly VacpTurnRecord[];
  selected: ProvenanceCheckpoint | null;
  /** Latest original checkpoint, before the viewer's filter. */
  latest: ProvenanceCheckpoint | null;
  error?: string;
};
export type ProvenanceReplaySource = VacpProvenanceSource &
  VacpExecutionSource & {
    inspect(): Promise<VacpObservation> | VacpObservation;
  };
export type ProvenanceReplayOptions = {
  restore: (observation: VacpObservation, options: VacpActionExecutionOptions) => Promise<VacpActionResult>;
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
