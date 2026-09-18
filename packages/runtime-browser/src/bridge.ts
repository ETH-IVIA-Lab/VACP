import { z } from 'zod';
import { VACP_SCHEMA_VERSION, type VacpRuntimeBridge } from '@vacp/protocol';
import type { VacpRuntime } from '@vacp/runtime';
import { getVacpBrowserOptions } from './options';
import { resolveVacpGlobalKey } from './window-globals';

const bridgeContract = z.object({
  version: z.literal(VACP_SCHEMA_VERSION),
  getCapabilities: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  getState: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  execute: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  getRuntime: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  subscribe: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  refresh: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  setMode: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  setCursor: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  undo: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  redo: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  setStateOverride: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  setGraphOverride: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  clearOverrides: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  dispatch: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  startObserving: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
  stopObserving: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function').optional(),
});

const runtimeContract = bridgeContract.required().extend({
  runtimeId: z.string(),
  signal: z.instanceof(AbortSignal),
  subscribeSnapshots: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  subscribeCapabilities: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  sessionKey: z.string().optional(),
  update: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
  dispose: z.custom<(...args: never[]) => unknown>((value) => typeof value === 'function'),
});

function isBridge(value: unknown): value is VacpRuntimeBridge {
  return bridgeContract.safeParse(value).success;
}

function isRuntime(value: unknown): value is VacpRuntime {
  return runtimeContract.safeParse(value).success;
}

export function readExposedRuntime(globalKey: string): VacpRuntime | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, globalKey);
  const value = descriptor?.get ? descriptor.get.call(globalThis) : descriptor?.value;

  return isRuntime(value) ? value : undefined;
}

export function getVacpBridge(options?: { globalKey?: string }): VacpRuntimeBridge | undefined {
  if (!getVacpBrowserOptions().exposeBridge) return undefined;

  const key = resolveVacpGlobalKey(options?.globalKey);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  const value = descriptor?.get ? descriptor.get.call(globalThis) : descriptor?.value;

  return isBridge(value) ? value : undefined;
}
