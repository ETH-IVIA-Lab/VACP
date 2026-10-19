import type { VacpProvider } from '@ethivia/vacp-protocol';
import type { VgplotBindings } from './bindings';

/** Optional presentation borrows the provider generation's canonical native inventory. */
export const providerBindings = new WeakMap<VacpProvider, VgplotBindings>();
