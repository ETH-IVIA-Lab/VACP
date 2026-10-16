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

export interface VegaLiteProviderOptions {
  appId: string;
  viewId: string;
  vizId: string;
  title?: string;
  description?: string;
}
