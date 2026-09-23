import type { VacpProvider, VacpRef } from '@vacp/protocol';
import type { VegaLiteBindings } from './bindings';
import type { VegaViewLike } from './types';

/** Optional presentation borrows the provider generation's canonical native inventory. */
export const providerBindings = new WeakMap<
  VacpProvider,
  {
    bindings: VegaLiteBindings;
    view: VegaViewLike;
    vizRef: VacpRef;
  }
>();
