import { z } from 'zod';
import { VACP_SCHEMA_VERSION, type VacpRuntimeBridge } from '@vacp/protocol';
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
  refresh: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  dispatch: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  startObserving: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  stopObserving: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
});

function isBridge(value: unknown): value is VacpRuntimeBridge {
  return bridgeContract.safeParse(value).success;
}

export function getVacpBridge(options?: { globalKey?: string }): VacpRuntimeBridge | undefined {
  const key = resolveVacpGlobalKey(options?.globalKey);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const value = descriptor?.get ? descriptor.get.call(globalThis) : descriptor?.value;

  return isBridge(value) ? value : undefined;
}
