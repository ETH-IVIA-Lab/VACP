import type { VacpProvider } from '@ethivia/vacp-sdk';
import type { VgplotBindings } from './bindings';

/** Optional presentation borrows the provider generation's canonical native inventory. */
export const providerBindings = new WeakMap<VacpProvider, { bindings: VgplotBindings; root?: Element }>();
