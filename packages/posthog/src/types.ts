import type { ProvenanceSource } from '@ethivia/vacp-sdk';

export type VacpAnalyticsProvider = Readonly<{
  capture: (event: string, properties?: Record<string, unknown>) => void;
  setSessionProperties?: (properties: Record<string, unknown>) => void;
}>;

type VacpRuntimeAnalyticsOptions = Readonly<{
  /** Include analytical state in telemetry. Defaults to false. */
  captureSnapshots?: boolean;
  getBaseProperties?: () => Record<string, unknown>;
}>;

export type VacpRuntimeAnalyticsInstallation = Readonly<{ dispose(): void }>;

export type InstallVacpRuntimeAnalyticsArgs = VacpRuntimeAnalyticsOptions &
  Readonly<{
    bridge: ProvenanceSource & { readonly version: string; readonly signal: AbortSignal };
    provider: VacpAnalyticsProvider;
  }>;
