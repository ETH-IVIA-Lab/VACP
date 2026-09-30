import { z } from 'zod';
import { VACP_SCHEMA_VERSION, type VacpPageBridge } from '@vacp/protocol';
import { resolveVacpGlobalKey } from './window-globals';

const bridgeContract = z.object({
  version: z.literal(VACP_SCHEMA_VERSION),
  inspect: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  observe: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  getCapabilities: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  getState: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  execute: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  getProvenance: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  subscribeProvenance: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  beginAgentActivity: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  narrate: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  getActiveExecutions: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  subscribeExecutions: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  signal: z.instanceof(AbortSignal),
  refresh: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  dispatch: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  startObserving: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  stopObserving: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
});

function isBridge(value: unknown): value is VacpPageBridge {
  return bridgeContract.safeParse(value).success;
}

export function getVacpBridge(options?: { globalKey?: string }): VacpPageBridge | undefined {
  const key = resolveVacpGlobalKey(options?.globalKey);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const value = descriptor?.get ? descriptor.get.call(globalThis) : descriptor?.value;

  return isBridge(value) ? value : undefined;
}
