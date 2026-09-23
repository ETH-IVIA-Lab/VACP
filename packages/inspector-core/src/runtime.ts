import type { VacpRuntimeBridge } from '@vacp/protocol';
import type { InspectorClient } from './types';

export type InspectorRuntime = Pick<VacpRuntimeBridge, 'inspect' | 'execute' | 'subscribeProvenance'>;

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
    subscribe: (invalidate) => runtime.subscribeProvenance(() => invalidate()),
    restore: options.restore,
    reveal: options.reveal,
  };
}
