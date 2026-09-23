import type {
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpExecutionSource,
  VacpObservation,
  VacpProvenanceSource,
} from '@vacp/protocol';
import type { ProvenanceCheckpoint } from './checkpoints';

export type ProvenanceReplayState = {
  phase: 'live' | 'restoring' | 'reviewing' | 'error';
  steps: readonly ProvenanceCheckpoint[];
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
