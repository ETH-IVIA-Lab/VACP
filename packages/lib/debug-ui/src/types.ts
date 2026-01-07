import type {
  VacpCapabilitiesSnapshot,
  VacpPlaybook,
  VacpRuntimeBridge,
  VacpRuntimeSnapshot,
  VacpStateSnapshot,
} from '@vacp/core';

export type VacpDebugUiEnabled = boolean | 'auto';

export type VacpDebugModuleId = string;

export type VacpDebugModuleContext = {
  bridge: VacpWindowBridge;
  runtime: VacpRuntimeSnapshot;
  playbooks: VacpPlaybook[];
  requestRender: () => void;
};

export type VacpDebugModule = {
  id: VacpDebugModuleId;
  title: string;
  icon?: string;
  /** Render the module into the provided container. Should fully replace its contents. */
  render: (container: HTMLElement, ctx: VacpDebugModuleContext) => void | Promise<void>;
};

export interface VacpDebugUiOptions {
  /**
   * If `true`, always show the overlay.
   * If `false`, never show it.
   * If `'auto'`, enable when `?vacpDebug=1` is present or localStorage has
   * `vacp:debug=1`.
   */
  enabled?: VacpDebugUiEnabled;
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  includeActions?: boolean;
  includeStatePreview?: boolean;
  /**
   * Optional custom modules. When omitted, the built-in modules are installed.
   * This is the extension point for growing debug features without rewriting the shell UI.
   */
  modules?: VacpDebugModule[];
}

export type VacpWindowBridge = VacpRuntimeBridge & {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  getState: () => Promise<VacpStateSnapshot>;
  getRuntime?: () => Promise<VacpRuntimeSnapshot>;
  getPlaybooks?: () => Promise<VacpPlaybook[]>;
  getDemos?: () => Promise<VacpPlaybook[]>;
};
