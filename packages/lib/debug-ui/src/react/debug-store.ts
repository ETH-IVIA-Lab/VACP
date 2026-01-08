import type { VacpPlaybook, VacpRuntimeSnapshot } from '@vacp/core';
import { create } from 'zustand';

import type { VacpWindowBridge } from '../types';

export type VacpDebugBridgeStatus = 'missing' | 'unknown' | 'ok';

export type VacpDebugModuleId = 'graph' | 'data' | 'actions' | 'history' | 'playbook' | 'json';

export type VacpDebugUiState = {
  globalKey: string;
  includeActionsDefault: boolean;

  open: boolean;
  moduleId: VacpDebugModuleId;
  bridgeStatus: VacpDebugBridgeStatus;

  bridge: VacpWindowBridge | null;
  runtime: VacpRuntimeSnapshot | null;
  playbooks: VacpPlaybook[];
  error: string | null;

  setGlobalKey: (key: string) => void;
  setIncludeActionsDefault: (include: boolean) => void;

  setOpen: (open: boolean) => void;
  setModuleId: (id: VacpDebugModuleId) => void;
  setBridgeStatus: (status: VacpDebugBridgeStatus) => void;

  setBridge: (bridge: VacpWindowBridge | null) => void;
  setRuntime: (runtime: VacpRuntimeSnapshot | null) => void;
  setPlaybooks: (playbooks: VacpPlaybook[]) => void;
  setError: (error: string | null) => void;
};

const MODULE_KEY = 'vacp:debug:module';
const readInitialModule = (): VacpDebugModuleId => {
  try {
    const raw = localStorage.getItem(MODULE_KEY);
    if (!raw) return 'graph';
    if (raw === 'graph' || raw === 'data' || raw === 'actions' || raw === 'history' || raw === 'playbook' || raw === 'json') {
      return raw;
    }
    return 'graph';
  } catch {
    return 'graph';
  }
};

const saveModule = (id: VacpDebugModuleId) => {
  try {
    localStorage.setItem(MODULE_KEY, id);
  } catch {
    // ignore
  }
};

export const useVacpDebugUiStore = create<VacpDebugUiState>((set) => ({
  globalKey: '__vacp',
  includeActionsDefault: true,

  open: false,
  moduleId: readInitialModule(),
  bridgeStatus: 'missing',

  bridge: null,
  runtime: null,
  playbooks: [],
  error: null,

  setGlobalKey: (key) => set({ globalKey: key }),
  setIncludeActionsDefault: (include) => set({ includeActionsDefault: include }),

  setOpen: (open) => set({ open }),
  setModuleId: (id) => {
    saveModule(id);
    set({ moduleId: id });
  },
  setBridgeStatus: (bridgeStatus) => set({ bridgeStatus }),

  setBridge: (bridge) => set({ bridge }),
  setRuntime: (runtime) => set({ runtime }),
  setPlaybooks: (playbooks) => set({ playbooks }),
  setError: (error) => set({ error }),
}));

