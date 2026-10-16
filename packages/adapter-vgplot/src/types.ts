export interface VgplotMarkLike {
  type?: string;
  index?: number;
  sourceTable?: () => string | null;
  /** The selection whose predicate filters the rows the mark reads, as Mosaic's `filterBy`. */
  filterBy?: Pick<VgplotSelectionLike, 'predicate'>;
  channels?: Array<{ channel: string; as?: string; field?: unknown }>;
}

export interface VgplotScaleLike<Value = number | Date> {
  /** Plot's scale type. Dates read in UTC unless it is `time`. */
  type?: string;
  domain?: unknown[] | (() => unknown[]);
  apply(value: Value): number;
}

export interface VgplotSelectionLike<Value = unknown> {
  readonly active?: { source?: unknown };
  value?: Value;
  single?: boolean;
  valueFor?: (source: VgplotInteractorLike) => unknown;
  update?: (value: Value) => unknown;
  pending?: (type: string) => Promise<unknown>;
  predicate?: (client?: undefined, noSkip?: boolean) => unknown;
}

export interface VgplotInteractorLike<Value = unknown> {
  channel?: string;
  value?: Value;
  selection?: VgplotSelectionLike;
  scale?: VgplotScaleLike;
  svg?: { scale(axis: 'x' | 'y'): VgplotScaleLike | undefined };
  xscale?: VgplotScaleLike;
  yscale?: VgplotScaleLike;
  xsel?: VgplotSelectionLike;
  ysel?: VgplotSelectionLike;
  x?: unknown;
  y?: unknown;
  xfield?: unknown;
  yfield?: unknown;
  clause?: (value: unknown, field?: unknown, scale?: unknown) => unknown;
  publish?: (value: unknown) => unknown;
  g?: { call(callback: (...args: never[]) => unknown, value: unknown): unknown; nodes?: () => SVGGraphicsElement[] };
  brush?: { moveSilent: (...args: never[]) => unknown };
  init?: (svg: SVGElement) => unknown;
}

export interface VgplotPlotLike {
  pending?: (...args: unknown[]) => unknown;
  render?: (...args: unknown[]) => unknown;
  element?: HTMLElement;
  marks: VgplotMarkLike[];
  interactors: VgplotInteractorLike[];
  legends?: unknown[];
  setAttribute?: (name: string, value: unknown, options?: { silent?: boolean }) => boolean;
  update?: (...args: unknown[]) => unknown;
  getAttribute?: (name: string) => unknown;
}

export interface VgplotLegendLike {
  channel: string;
  handler?: VgplotInteractorLike | null;
  selection?: VgplotSelectionLike;
  element?: HTMLElement;
  legend?: Element | null;
}

export interface VgplotTableLike {
  schema?: Array<{ column: string }>;
  /** The selection whose predicate filters the rows the table view shows, as Mosaic's `filterBy`. */
  filterBy?: Pick<VgplotSelectionLike, 'predicate'>;
  readonly pending?: Promise<unknown>;
  sortHeader?: HTMLElement | null;
  element?: HTMLElement;
  from?: string;
  columns?: unknown;
  offset?: number;
  limit?: number;
  sortColumn?: string | null;
  sortDesc?: boolean;
  selection?: {
    value?: unknown;
    update?: (...args: unknown[]) => unknown;
    predicate?: (client?: undefined, noSkip?: boolean) => unknown;
  };
  update?: (...args: unknown[]) => unknown;
  requestData?: (...args: unknown[]) => unknown;
}

export interface VgplotProviderOptions {
  appId: string;
  viewId: string;
  title?: string;
  description?: string;
}
