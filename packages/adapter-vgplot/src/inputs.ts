import { clauseNone } from '@uwdata/mosaic-core';
import { jsonValue } from './json';
import { stableStringify, type VacpRef } from '@ethivia/vacp-protocol';

import { inputType } from './native-classes';
import { makeViewRef } from './refs';
import type { VgplotProviderOptions } from './types';

type VgplotInputLike = {
  element?: HTMLElement;
  selection?: {
    value?: unknown;
    update?: (...args: unknown[]) => unknown;
    pending?: (type: string) => Promise<void>;
    valueFor?: (source: VgplotInputLike) => unknown;
    predicate?: (...args: unknown[]) => unknown;
  };
  publish?: (value: unknown) => unknown;
  reset?: () => unknown;
  selectedValue?: (value?: unknown) => unknown;
  slider?: HTMLInputElement;
  searchbox?: HTMLInputElement;
  curval?: HTMLElement;
  selectionType?: string;
  from?: string;
  column?: string;
  field?: string;
  label?: string;
  data?: Array<{ value: unknown; label?: string }>;
  select?: HTMLSelectElement;
};

type InputValueRead = { ok: true; value: unknown } | { ok: false; value: unknown; error: string };

export type CollectedInput = {
  inputId: string;
  ref: VacpRef;
  element: HTMLElement;
  input: VgplotInputLike;
  meta: {
    kind: string;
    label?: string;
    from?: string;
    column?: string;
    field?: string;
    options?: Array<{ value: unknown; label?: string }>;
    optionsCount?: number;
    optionsTruncated?: boolean;
    readError?: string;
  };
};

export function menuOptions(input: CollectedInput['input']): Array<{ value: unknown; label?: string }> {
  if (inputType(input) !== 'Menu') return [];
  return (input.data ?? []).map((option, index) => ({
    value: option.value,
    label: option.label ?? input.select?.options[index]?.label,
  }));
}

export function readInputValue(input: CollectedInput): InputValueRead {
  const inst = input.input;

  try {
    if (inst.selection?.valueFor) return { ok: true, value: inst.selection.valueFor(inst) ?? null };
    if (typeof inst.selectedValue === 'function') return { ok: true, value: inst.selectedValue() };
  } catch (error) {
    return {
      ok: false,
      value: inst.select ? inst.select.value : undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (inst.slider) {
    const n = inst.slider.valueAsNumber;

    return { ok: true, value: Number.isFinite(n) ? n : inst.slider.value };
  }

  if (inst.searchbox) return { ok: true, value: inst.searchbox.value };

  if (inst.select) return { ok: true, value: inst.select.value };

  return { ok: true, value: undefined };
}

export function hasIndexedOptions(input: CollectedInput): boolean {
  return menuOptions(input.input).length > 0;
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

function coerceFiniteSliderValue(input: VgplotInputLike, value: unknown): number {
  const candidate = Array.isArray(value) && input.selectionType === 'interval' ? value[value.length - 1] : value;

  if (Array.isArray(candidate)) throw new Error('Slider value must be a scalar number');

  const n =
    typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string' && candidate.trim()
        ? Number(candidate)
        : NaN;

  if (!Number.isFinite(n)) throw new Error('Slider value must be a finite number');

  return n;
}

async function waitForInputDispatch(input: VgplotInputLike): Promise<void> {
  await input.selection?.pending?.('value');
}

export function collectInputs(root: ParentNode, options: VgplotProviderOptions): CollectedInput[] {
  /**
   * VGPlot inputs (Menu/Slider/etc.) are not plot interactors, but they are part
   * of the semantic interaction surface. Mosaic's Input base assigns
   * `element.value = this`, so each widget is found through its container.
   */
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.input'));
  const out: CollectedInput[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const inst = (el as { value?: unknown }).value;

    if (!inst || typeof inst !== 'object') continue;
    const input = inst as VgplotInputLike;
    const kind = inputType(input) ?? 'Input';

    const label =
      (typeof input.label === 'string' && input.label) || el.querySelector('label')?.textContent?.trim() || undefined;

    const inputId = String(i);
    const ref = makeViewRef({ appId: options.appId, viewId: options.viewId, suffix: `/input/${inputId}` });
    const choices = kind === 'Menu' ? menuOptions(input) : undefined;
    let capturedOptions: CollectedInput['meta']['options'];
    let readError: string | undefined;
    try {
      capturedOptions = choices?.slice(0, 200).map((option) => ({ ...option, value: jsonValue(option.value) }));
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
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
        options: capturedOptions,
        readError,
        optionsCount: choices?.length,
        optionsTruncated: choices ? choices.length > 200 : undefined,
      },
    });
  }

  return out;
}

export function prepareInputAction(input: CollectedInput, call: { name: string; params?: unknown }) {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const inst = input.input;

  if (call.name === 'vgplot.clear_input') {
    const selection = inst.selection;
    const clause = selection?.predicate ? clauseNone(inst) : null;
    return async () => {
      inst.reset?.();
      let next: unknown = null;
      if (inst.select && !('predicate' in (inst.selection ?? {})) && inst.select.options.length) {
        inst.select.selectedIndex = 0;
        next = menuOptions(inst)[0]?.value ?? null;
      }
      if (clause) selection!.update!(clause);
      else inst.publish?.(next);
      await waitForInputDispatch(inst);
      return { cleared: true, value: next };
    };
  }

  if (call.name === 'vgplot.set_input_option_index') {
    if (!hasIndexedOptions(input)) throw new Error('Input does not expose indexed options');
    const idx = Number(params.index);

    if (!Number.isInteger(idx)) throw new Error('index must be an integer');

    if (idx < 0) throw new Error('index must be >= 0');
    const options = menuOptions(inst);
    const count = options.length;

    if (idx >= count) throw new Error(`index must be < ${count}`);

    const next = options[idx]!.value;
    return async () => {
      if (inst.select && typeof inst.select.selectedIndex === 'number') inst.select.selectedIndex = idx;
      inst.select?.dispatchEvent(new Event('input', { bubbles: true }));
      await waitForInputDispatch(inst);

      return { set: true, index: idx, value: next };
    };
  }

  if (call.name === 'vgplot.set_input_value') {
    const searchbox = inst.searchbox;
    if (searchbox && typeof params.value !== 'string') throw new Error('Search value must be a string');
    const value = inst.slider ? coerceFiniteSliderValue(inst, params.value) : params.value;
    const control = inst.slider ?? searchbox ?? inst.select;
    if (!control) throw new Error('Input has no native control');
    const index = inst.select ? menuOptions(inst).findIndex((option) => valuesMatch(option.value, value)) : -1;
    if (inst.select && index < 0) throw new Error('Unknown menu option value');
    return async () => {
      if (inst.searchbox !== searchbox) throw new Error('Search input binding changed; prepare again');
      if (inst.slider) inst.slider.value = String(value);
      if (searchbox) searchbox.value = String(value);
      if (inst.select) inst.select.selectedIndex = index;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      await waitForInputDispatch(inst);

      return { set: true, value: inst.slider ? Number(inst.slider.value) : value };
    };
  }

  throw new Error(`Unsupported input action: ${call.name}`);
}
