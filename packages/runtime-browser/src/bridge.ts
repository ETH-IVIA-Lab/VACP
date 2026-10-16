import { VACP_SCHEMA_VERSION, type VacpPageBridge } from '@vacp/protocol';
import { VACP_GLOBAL_KEY } from './window-globals';

const methods = [
  'observe',
  'getCapabilities',
  'getState',
  'execute',
  'inspect',
  'refresh',
  'getProvenance',
  'subscribeProvenance',
  'beginAgentActivity',
  'narrate',
  'getActiveExecutions',
  'subscribeExecutions',
] as const satisfies readonly (keyof VacpPageBridge)[];

function isBridge(value: unknown): value is VacpPageBridge {
  if (typeof value !== 'object' || value === null) return false;
  // The runtime publishes its members as own properties.
  const members: Record<string, unknown> = { ...value };
  return (
    members.version === VACP_SCHEMA_VERSION &&
    members.signal instanceof AbortSignal &&
    methods.every((method) => typeof members[method] === 'function')
  );
}

export function getVacpBridge(options?: { globalKey?: string }): VacpPageBridge | undefined {
  const key = options?.globalKey || VACP_GLOBAL_KEY;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const value = descriptor?.get ? descriptor.get.call(globalThis) : descriptor?.value;

  return isBridge(value) ? value : undefined;
}
