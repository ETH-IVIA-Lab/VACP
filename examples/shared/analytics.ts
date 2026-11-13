import { posthog } from 'posthog-js';
import { installVacpPosthog } from '@ethivia/vacp-posthog';
import type { VacpRuntime } from '@ethivia/vacp-sdk';

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
  posthog.startSessionRecording();
  return installVacpPosthog(bridge, posthog, {
    captureSnapshots: import.meta.env.VACP_POSTHOG_CAPTURE_SNAPSHOTS === '1',
    properties,
  }).dispose;
}
