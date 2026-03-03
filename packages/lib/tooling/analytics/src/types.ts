import type { VacpRuntimeBridge } from '@vacp/core';

export type VacpAnalyticsProvider = Readonly<{
  name: string;
  /** Capture an analytics event (e.g. `posthog.capture`). */
  capture: (event: string, properties?: Record<string, unknown>) => void;
  /**
   * Attach session-level properties (e.g. PostHog `register_for_session`) so they
   * show up next to session replays.
   */
  setSessionProperties?: (properties: Record<string, unknown>) => void;
  /** Optional session recording toggle (e.g. PostHog `startSessionRecording`). */
  startSessionRecording?: () => void;
}>;

export type VacpRuntimeAnalyticsOptions = Readonly<{
  /** Prefix for emitted event names (defaults to `vacp`). */
  eventPrefix?: string;
  /** Max entries mirrored into session properties (defaults to 50). */
  historyLimit?: number;
  /** Debounce for session-property flushes (defaults to 1000ms). */
  sessionFlushIntervalMs?: number;
  /**
   * If true, include VACP state snapshots (and `snapshot` entries) in analytics payloads.
   *
   * Defaults to false to avoid sending potentially high-frequency state updates.
   */
  captureSnapshots?: boolean;
  /**
   * Throttle for snapshot events (defaults to 1000ms). Only applies when `captureSnapshots` is true.
   *
   * The runtime can emit snapshots at high frequency (e.g. brush interactions), so we "bounce"
   * to at most one snapshot per interval, keeping the latest snapshot.
   */
  snapshotCaptureIntervalMs?: number;
  /**
   * Extra properties to attach to every event/session update (app/view ids, etc).
   * Keep this small — it’s included everywhere.
   */
  getBaseProperties?: () => Record<string, unknown>;
  /** If true (default), call `provider.startSessionRecording()` when available. */
  startSessionRecording?: boolean;
}>;

export type VacpRuntimeAnalyticsInstallation = Readonly<{
  cleanup: () => void;
}>;

export type InstallVacpRuntimeAnalyticsArgs = Readonly<{
  bridge: VacpRuntimeBridge;
  provider: VacpAnalyticsProvider;
  options?: VacpRuntimeAnalyticsOptions;
}>;
