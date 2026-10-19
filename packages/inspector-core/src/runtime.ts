import type {
  VacpObservation,
  VacpActionCall,
  VacpActionExecutionOptions,
  VacpActionResult,
} from '@ethivia/vacp-protocol';
import type { InspectorClient } from './types';

export type InspectorRuntime = {
  inspect(): Promise<VacpObservation>;
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
  subscribeSnapshots(listener: () => void): () => void;
};

export function createRuntimeInspectorClient(options: {
  id: string;
  title: string;
  runtime: InspectorRuntime;
  reveal?: InspectorClient['reveal'];
  restore?: InspectorClient['restore'];
}): InspectorClient {
  const { runtime } = options;
  return {
    id: options.id,
    title: options.title,
    observe: async ({ signal }) => {
      signal.throwIfAborted();
      return await runtime.inspect();
    },
    execute: (call, controls) => runtime.execute(call, controls),
    subscribe: (invalidate) => runtime.subscribeSnapshots(invalidate),
    restore: options.restore,
    reveal: options.reveal,
  };
}
