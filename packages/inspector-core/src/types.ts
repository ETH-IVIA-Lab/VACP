import type { VacpActionCall, VacpActionResult, VacpObservation, VacpRef } from '@vacp/protocol';

export type InspectorRequest = { signal: AbortSignal };

/** A host-owned analytical session. Optional methods describe available capabilities. */
export interface InspectorClient<Params = unknown, Result = unknown> {
  readonly id: string;
  readonly title: string;
  /** Complete catalog, including unavailable entities and operations. */
  observe(options: InspectorRequest): Promise<VacpObservation>;
  execute?(call: VacpActionCall<Params>, options: InspectorRequest): Promise<VacpActionResult<Result>>;
  subscribe?(invalidate: () => void): () => void;
  restore?(observation: InspectionObservation, options: InspectorRequest): Promise<VacpActionResult<Result>>;
  reveal?(ref: VacpRef, options: InspectorRequest): void | Promise<void>;
}

export type InspectionSnapshot<T> = T extends Date
  ? string | null
  : T extends object
    ? { readonly [Key in keyof T]: InspectionSnapshot<T[Key]> }
    : T;
export type InspectionObservation = InspectionSnapshot<VacpObservation>;
export type InspectionRecord = { readonly id: number; readonly observation: InspectionObservation };

export type InspectorOperation<Params = unknown> =
  | { readonly kind: 'execute'; readonly call: InspectionSnapshot<VacpActionCall<Params>> }
  | { readonly kind: 'restore'; readonly observation: InspectionObservation };

export type InspectorOperationState<Params = unknown, Result = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly operation: InspectorOperation<Params> }
  | {
      readonly status: 'complete';
      readonly operation: InspectorOperation<Params>;
      readonly result: InspectionSnapshot<VacpActionResult<Result>>;
    }
  | { readonly status: 'error'; readonly operation: InspectorOperation<Params>; readonly error: Error }
  | { readonly status: 'capture-error'; readonly operation: InspectorOperation<Params>; readonly error: Error };

export type InspectorState<Params = unknown, Result = unknown> = {
  readonly status: 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
  readonly observation: InspectionObservation | null;
  readonly observationError: Error | null;
  readonly records: readonly InspectionRecord[];
  readonly operation: InspectorOperationState<Params, Result>;
};

export type InspectorSessionOptions = {
  /** Number of changed observations to retain. Defaults to 0. */
  historyLimit?: number;
};

export interface InspectorSession<Params = unknown, Result = unknown> {
  readonly client: InspectorClient<Params, Result>;
  getState(): InspectorState<Params, Result>;
  /** Listen to state changes. Subscription alone performs no I/O. */
  subscribe(listener: () => void): () => void;
  /** Start observation and source invalidation. Repeated starts are idempotent. */
  start(): void;
  refresh(): Promise<void>;
  execute(call: VacpActionCall<Params>, options?: { signal?: AbortSignal }): Promise<VacpActionResult<Result>>;
  restore(observation: InspectionObservation, options?: { signal?: AbortSignal }): Promise<VacpActionResult<Result>>;
  reveal(ref: VacpRef, options?: { signal?: AbortSignal }): Promise<void>;
  clearHistory(): void;
  dispose(): void;
}
