import type { VacpActionCall, VacpActionResult, VacpObservation, VacpRef, VacpRestore } from '@vacp/protocol';

export type InspectorRequest = { signal: AbortSignal };

/** A host-owned analytical session. Optional methods describe available capabilities. */
export interface InspectorClient {
  readonly id: string;
  readonly title: string;
  /** Complete catalog, including unavailable entities and operations. */
  observe(options: InspectorRequest): Promise<VacpObservation>;
  execute?(call: VacpActionCall, options: InspectorRequest): Promise<VacpActionResult>;
  subscribe?(invalidate: () => void): () => void;
  restore?: VacpRestore;
  reveal?(ref: VacpRef, options: InspectorRequest): void | Promise<void>;
}

export type InspectionSnapshot<T> = T extends Date
  ? string | null
  : T extends object
    ? { readonly [Key in keyof T]: InspectionSnapshot<T[Key]> }
    : T;
export type InspectionObservation = InspectionSnapshot<VacpObservation>;
export type InspectionRecord = { readonly id: number; readonly observation: InspectionObservation };

export type InspectorOperation =
  | { readonly kind: 'execute'; readonly call: InspectionSnapshot<VacpActionCall> }
  | { readonly kind: 'restore'; readonly observation: InspectionObservation };

export type InspectorOperationState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly operation: InspectorOperation }
  | {
      readonly status: 'complete';
      readonly operation: InspectorOperation;
      readonly result: InspectionSnapshot<VacpActionResult>;
    }
  | { readonly status: 'error'; readonly operation: InspectorOperation; readonly error: Error }
  | { readonly status: 'capture-error'; readonly operation: InspectorOperation; readonly error: Error };

export type InspectorState = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
  readonly observation: InspectionObservation | null;
  readonly observationError: Error | null;
  readonly records: readonly InspectionRecord[];
  readonly operation: InspectorOperationState;
};

export type InspectorSessionOptions = {
  /** Number of changed observations to retain. Defaults to 0. */
  historyLimit?: number;
};

export interface InspectorSession {
  readonly client: InspectorClient;
  getState(): InspectorState;
  /** Listen to state changes. Subscription alone performs no I/O. */
  subscribe(listener: () => void): () => void;
  /** Start observation and source invalidation. Repeated starts are idempotent. */
  start(): void;
  refresh(): Promise<void>;
  execute(call: VacpActionCall, options?: { signal?: AbortSignal }): Promise<VacpActionResult>;
  restore(observation: InspectionObservation, options?: { signal?: AbortSignal }): Promise<VacpActionResult>;
  reveal(ref: VacpRef, options?: { signal?: AbortSignal }): Promise<void>;
  clearHistory(): void;
  dispose(): void;
}
