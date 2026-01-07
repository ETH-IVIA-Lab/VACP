import type { VacpRef } from '@vacp/core';

import { makeViewRef } from './refs';
import type { InstallVacpOnVgplotDashboardOptions } from './types';

type VgplotInputElement = HTMLElement & { value?: unknown };

type VgplotInputLike = {
  constructor?: { name?: string };
  element?: HTMLElement;
  selection?: { update?: (...args: unknown[]) => unknown };
  publish?: (value: unknown) => unknown;
  reset?: () => unknown;
  selectedValue?: (value?: unknown) => unknown;
  from?: string;
  column?: string;
  field?: string;
  label?: string;
  data?: Array<{ value: unknown; label?: string }>;
  select?: HTMLSelectElement;
};

export type CollectedInput = {
  inputId: string;
  ref: VacpRef;
  element: HTMLElement;
  input: VgplotInputLike;
  meta: { kind: string; label?: string; from?: string; column?: string; field?: string };
};

export function collectInputs(root: ParentNode, options: InstallVacpOnVgplotDashboardOptions): CollectedInput[] {
  /**
   * Mosaic inputs (Menu/Slider/etc.) are not plot interactors, but they are part
   * of the semantic interaction surface.
   *
   * mosaic-inputs' Input base assigns `element.value = this`, so we can locate
   * and control widgets without depending on Mosaic types at build time.
   */
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.input'));
  const out: CollectedInput[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as VgplotInputElement;
    const inst = (el as unknown as { value?: unknown }).value;
    if (!inst || typeof inst !== 'object') continue;
    const input = inst as VgplotInputLike;
    const kind = input.constructor?.name ?? 'Input';
    const label =
      (typeof input.label === 'string' && input.label) || el.querySelector('label')?.textContent?.trim() || undefined;

    const inputId = String(i);
    const ref = makeViewRef({ appId: options.appId, viewId: options.viewId, suffix: `/input/${inputId}` });
    out.push({
      inputId,
      ref,
      element: el,
      input,
      meta: {
        kind,
        label,
        from: typeof input.from === 'string' ? input.from : undefined,
        column: typeof input.column === 'string' ? input.column : undefined,
        field: typeof input.field === 'string' ? input.field : undefined,
      },
    });
  }
  return out;
}

export async function executeInputAction(
  input: CollectedInput,
  call: { name: string; params?: unknown },
): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inst = input.input as any;

  if (call.name === 'mosaic.clear_input') {
    if (typeof inst.reset === 'function') inst.reset();
    if (typeof inst.publish === 'function') inst.publish('');
    return { cleared: true };
  }

  if (call.name === 'mosaic.set_input_option_index') {
    const idx = Number(params.index);
    if (!Number.isFinite(idx)) throw new Error('index must be a number');
    if (inst.select && typeof inst.select.selectedIndex === 'number') inst.select.selectedIndex = idx;
    let next: unknown = undefined;
    if (inst.select && inst.select.options && inst.select.options.length > idx) {
      next = inst.select.options[idx]?.value ?? inst.select.value;
    } else if (Array.isArray(inst.data) && inst.data[idx]) {
      next = inst.data[idx].value;
    } else if (typeof inst.selectedValue === 'function') {
      try {
        next = inst.selectedValue();
      } catch {
        next = inst.select ? inst.select.value : undefined;
      }
    } else if (inst.select) {
      next = inst.select.value;
    }
    if (typeof inst.publish === 'function') inst.publish(next);
    return { set: true, index: idx, value: next };
  }

  if (call.name === 'mosaic.set_input_value') {
    const value = params.value;
    if (typeof inst.selectedValue === 'function') inst.selectedValue(value);
    if (inst.select) inst.select.value = String(value);
    if (typeof inst.publish === 'function') inst.publish(value);
    return { set: true, value };
  }

  throw new Error(`Unsupported input action: ${call.name}`);
}
