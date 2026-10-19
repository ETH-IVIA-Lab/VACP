import { posthog } from 'posthog-js';
import { installVacpRuntimeAnalytics } from '@ethivia/vacp-analytics';
import { createPosthogProvider } from '@ethivia/vacp-analytics-posthog';
import type { VacpRuntime } from '@ethivia/vacp-runtime';

const apiKey: unknown = import.meta.env.VACP_POSTHOG_API_KEY;
const apiHost: unknown = import.meta.env.VACP_POSTHOG_API_HOST;
const defaults: unknown = import.meta.env.VACP_POSTHOG_DEFAULTS;
if (typeof apiKey === 'string' && apiKey) {
  posthog.init(apiKey, {
    api_host: typeof apiHost === 'string' ? apiHost : 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    ...(defaults === '2025-05-24' ||
    defaults === '2025-11-30' ||
    defaults === '2026-01-30' ||
    defaults === '2026-05-30' ||
    defaults === '2026-06-25' ||
    defaults === '2026-08-29' ||
    defaults === '2026-08-30' ||
    defaults === 'unset'
      ? { defaults }
      : {}),
  });
}

export function installExampleAnalytics(bridge: VacpRuntime, properties: Record<string, unknown>): () => void {
  if (typeof apiKey !== 'string' || !apiKey) return () => {};
  return installVacpRuntimeAnalytics({
    bridge,
    provider: createPosthogProvider(posthog),
    captureSnapshots: import.meta.env.VACP_POSTHOG_CAPTURE_SNAPSHOTS === '1',
    getBaseProperties: () => properties,
  }).dispose;
}
