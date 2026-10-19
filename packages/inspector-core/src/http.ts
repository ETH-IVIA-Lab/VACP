import { z } from 'zod';
import type { InspectorClient, InspectorRequest } from './types';
import { parseObservation, parseActionResult } from '@ethivia/vacp-protocol/validation';
import { notify } from './notify';

export type HttpInspectorOptions = {
  url: string;
  /** Supply fetch to configure credentials, headers, or a custom transport. */
  fetch?: typeof globalThis.fetch;
  /** Poll while subscribed. Set to 0 for explicit refresh. Defaults to 1000 ms. */
  intervalMs?: number;
  signal?: AbortSignal;
};

/** Resolve the server's session identity before opening observation and execution. */
export async function connectHttpInspectorClient(options: HttpInspectorOptions): Promise<InspectorClient> {
  const interval = options.intervalMs ?? 1000;
  if (!Number.isFinite(interval) || interval < 0) throw new RangeError('intervalMs must be non-negative and finite');
  const base = options.url.replace(/\/$/, '');
  const fetch = options.fetch ?? globalThis.fetch;
  const request = async (path: string, init: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    if (!response.ok) throw new Error(`Inspection request failed (${response.status}): ${await response.text()}`);
    return response.json();
  };
  const session = z
    .object({ id: z.string().min(1), title: z.string() })
    .parse(await request('/session', { signal: options.signal }));
  const headers = { 'X-VACP-Session': session.id };
  let activeReads = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    ...session,
    observe: async ({ signal }: InspectorRequest) => {
      activeReads++;
      try {
        return parseObservation(await request('/observation', { headers, signal }));
      } finally {
        activeReads--;
      }
    },
    execute: async (call, { signal }) => {
      const result = parseActionResult(
        await request('/operations', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(call),
          signal,
        }),
      );
      if (result.callId !== call.callId) throw new Error('Operation result callId does not match the request');
      return result;
    },
    subscribe(listener) {
      const subscription = () => listener();
      listeners.add(subscription);
      if (interval > 0 && timer === undefined)
        timer = setInterval(() => {
          if (!activeReads) notify(listeners);
        }, interval);
      return () => {
        listeners.delete(subscription);
        if (!listeners.size && timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
  };
}
