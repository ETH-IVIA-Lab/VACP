import type { VacpProvider, VacpRef } from '@ethivia/vacp-sdk';
import type { VegaLiteBindings } from './bindings';
import type { VegaViewLike } from './types';

/** Optional presentation borrows the provider generation's canonical native inventory. */
export const providerBindings = new WeakMap<
  VacpProvider,
  {
    bindings: VegaLiteBindings;
    view: VegaViewLike;
    vizRef: VacpRef;
    root?: HTMLElement;
  }
>();
