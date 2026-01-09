import { create } from 'zustand';

import type { VacpRef } from '@vacp/core';

export type VacpDebugModuleId = 'graph' | 'data' | 'actions' | 'history' | 'playbook' | 'json';

export type VacpDebugUiState = {
  includeActionsDefault: boolean;

  open: boolean;
  moduleId: VacpDebugModuleId;
  setIncludeActionsDefault: (include: boolean) => void;

  setOpen: (open: boolean) => void;
  setModuleId: (id: VacpDebugModuleId) => void;

  /** Whether to show secondary (right-hand) detail panes in modules. */
  graphInspectOpen: boolean;
  historyDetailsOpen: boolean;
  playbookDetailsOpen: boolean;
  setGraphInspectOpen: (open: boolean) => void;
  setHistoryDetailsOpen: (open: boolean) => void;
  setPlaybookDetailsOpen: (open: boolean) => void;

  /** Debug UI state that should survive tab switches within the overlay. */
  dataGraphSignature: string | null;
  dataSelectedHandleRef: VacpRef | null;
  dataSqlByHandleRef: Record<string, string>;
  dataLastResult: unknown;
  dataLastError: string | null;
  setDataGraphSignature: (sig: string) => void;
  setDataSelectedHandleRef: (ref: VacpRef | null) => void;
  setDataSqlForHandle: (ref: VacpRef, sql: string) => void;
  setDataLastResult: (value: { result: unknown; error?: string | null }) => void;
  resetDataModule: () => void;
};

const MODULE_KEY = 'vacp:debug:module';
const GRAPH_INSPECT_KEY = 'vacp:debug:graphInspectOpen';
const HISTORY_DETAILS_KEY = 'vacp:debug:historyDetailsOpen';
const PLAYBOOK_DETAILS_KEY = 'vacp:debug:playbookDetailsOpen';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function saveBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

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
  includeActionsDefault: true,

  open: false,
  moduleId: readInitialModule(),
  setIncludeActionsDefault: (include) => set({ includeActionsDefault: include }),

  setOpen: (open) => set({ open }),
  setModuleId: (id) => {
    saveModule(id);
    set({ moduleId: id });
  },

  graphInspectOpen: readBool(GRAPH_INSPECT_KEY, true),
  historyDetailsOpen: readBool(HISTORY_DETAILS_KEY, true),
  playbookDetailsOpen: readBool(PLAYBOOK_DETAILS_KEY, true),
  setGraphInspectOpen: (open) => {
    saveBool(GRAPH_INSPECT_KEY, open);
    set({ graphInspectOpen: open });
  },
  setHistoryDetailsOpen: (open) => {
    saveBool(HISTORY_DETAILS_KEY, open);
    set({ historyDetailsOpen: open });
  },
  setPlaybookDetailsOpen: (open) => {
    saveBool(PLAYBOOK_DETAILS_KEY, open);
    set({ playbookDetailsOpen: open });
  },

  dataGraphSignature: null,
  dataSelectedHandleRef: null,
  dataSqlByHandleRef: {},
  dataLastResult: null,
  dataLastError: null,
  setDataGraphSignature: (sig) => set({ dataGraphSignature: sig }),
  setDataSelectedHandleRef: (ref) => set({ dataSelectedHandleRef: ref }),
  setDataSqlForHandle: (ref, sql) => set((s) => ({ dataSqlByHandleRef: { ...s.dataSqlByHandleRef, [ref]: sql } })),
  setDataLastResult: ({ result, error }) => set({ dataLastResult: result, dataLastError: error ?? null }),
  resetDataModule: () => set({ dataSelectedHandleRef: null, dataSqlByHandleRef: {}, dataLastResult: null, dataLastError: null }),
}));
