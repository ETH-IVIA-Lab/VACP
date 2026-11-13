import type { View } from 'vega';

export interface VegaRuntimeContext {
  signals?: Record<string, unknown>;
  data?: Record<string, unknown>;
  subcontext?: Record<string, VegaRuntimeContext>;
  group?: import('./scene').VegaSceneItem;
  scales?: Record<string, { value: (value: unknown) => number }>;
  setState?: (state: unknown) => void;
}

export interface VegaViewLike extends View {
  runAsync: () => Promise<View>;
  _runtime?: VegaRuntimeContext;
  _trigger?: boolean;
}

export type VegaLiteParamLike = {
  name: string;
  value?: any;
  select?: any;
  bind?: any;
};

export interface VegaLiteSpecLike {
  params?: VegaLiteParamLike[];
  [key: string]: any;
}

/** The ids and labels that name a Vega-Lite source and its refs. */
export interface VegaLiteIdentity {
  appId: string;
  viewId: string;
  vizId: string;
  title?: string;
  description?: string;
}

export interface VegaLiteProviderOptions extends VegaLiteIdentity {
  /** The element the chart renders into. Presentation and tooltips read it. */
  root?: HTMLElement;
  view: View;
  spec: VegaLiteSpecLike;
  vgSpec: import('vega').Spec;
  data?: {
    duckdb:
      | import('@ethivia/vacp-sdk/data').VacpDuckDbClient
      | Promise<import('@ethivia/vacp-sdk/data').VacpDuckDbClient>;
    sql?: boolean;
    describe?: import('@ethivia/vacp-sdk/data').VacpDataHandleDescriber;
  };
}
