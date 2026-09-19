import type { VacpRef } from '@vacp/protocol';

import { makeViewRef } from './refs';
import type { VgplotProviderOptions } from './types';

type VgplotInputLike = {
  constructor?: { name?: string };
  element?: HTMLElement;
  selection?: { value?: unknown; update?: (...args: unknown[]) => unknown; pending?: (type: string) => Promise<void> };
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
  };
};

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v == null) return v;

    if (typeof v === 'function' || typeof v === 'symbol') return undefined;

    if (typeof v !== 'object') return v;
    const obj = v;

    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    if (Array.isArray(v)) return v.map(walk);
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.keys(rec)
      .sort()
      .forEach((k) => {
        out[k] = walk(rec[k]);
      });

    return out;
  };

  return JSON.stringify(walk(value)) ?? 'null';
}

function safeJsonValue(value: unknown) {
  if (value == null) return value;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  try {
    return JSON.parse(stableStringify(value));
  } catch {
    return String(value);
  }
}

function collectMenuOptions(
  input: VgplotInputLike,
  limit = 200,
): {
  options: Array<{ value: unknown; label?: string }>;
  count: number;
  truncated: boolean;
} | null {
  const normalized = (value: unknown, label?: string) => ({
    value: safeJsonValue(value),
    label: typeof label === 'string' && label.length ? label : undefined,
  });

  // Prefer VGPlot's data array so complex option values do not collapse to
  // DOM option strings like "-6,0".
  if (Array.isArray(input.data) && input.data.length > 0) {
    const count = input.data.length;
    const sliced = input.data.slice(0, limit);

    return {
      options: sliced.map((o, index) => normalized(o.value, o.label ?? input.select?.options?.[index]?.label)),
      count,
      truncated: count > limit,
    };
  }

  // Fallback to rendered <select> options for DOM-only menus.
  const select = input.select;

  if (select && typeof select.options?.length === 'number') {
    const opts = Array.from(select.options);
    const count = opts.length;
    const sliced = opts.slice(0, limit);

    return {
      options: sliced.map((o) => normalized(o.value, o.label)),
      count,
      truncated: count > limit,
    };
  }

  return null;
}

export function readInputValue(input: CollectedInput): InputValueRead {
  const inst = input.input;

  try {
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
  const inst = input.input;

  return Boolean((inst.select?.options?.length ?? 0) > 0 || (Array.isArray(inst.data) && inst.data.length > 0));
}

function optionCount(input: VgplotInputLike): number {
  if (Array.isArray(input.data) && input.data.length > 0) return input.data.length;

  return input.select?.options?.length ?? 0;
}

function optionValueAt(input: VgplotInputLike, index: number) {
  if (Array.isArray(input.data) && input.data[index]) return input.data[index].value;
  const option = input.select?.options?.[index];

  if (option) return option.value;

  return undefined;
}

function currentOptionValue(input: VgplotInputLike) {
  const index = input.select && input.select.selectedIndex >= 0 ? input.select.selectedIndex : 0;

  return optionValueAt(input, index);
}

function ensureSelectedOption(input: VgplotInputLike) {
  if (input.select && input.select.selectedIndex < 0 && input.select.options.length > 0) {
    input.select.selectedIndex = 0;
  }

  return currentOptionValue(input);
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

function selectMenuValue(input: VgplotInputLike, value: unknown): void {
  if (!input.select) return;

  if (Array.isArray(input.data)) {
    const index = input.data.findIndex((option) => valuesMatch(option.value, value));

    if (index >= 0) {
      input.select.selectedIndex = index;

      return;
    }
  }

  input.select.value = String(value);
}

function isSelectionLike(
  value: unknown,
): value is { update: (clause: unknown) => unknown; predicate: (...args: unknown[]) => unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'update' in value &&
    typeof value.update === 'function' &&
    'predicate' in value &&
    typeof value.predicate === 'function'
  );
}

function isParamLike(value: unknown): value is { update: (value: unknown) => unknown } {
  return value !== null && typeof value === 'object' && 'update' in value && typeof value.update === 'function';
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

function setSliderDomValue(input: VgplotInputLike, value: number): void {
  if (!input.slider) return;
  input.slider.value = String(value);

  if (input.curval) input.curval.innerText = input.slider.value;
}

async function waitForInputDispatch(input: VgplotInputLike): Promise<void> {
  if (typeof input.selection?.pending !== 'function') return;
  await input.selection.pending('value');
  await input.selection.pending('value');
}

export function collectInputs(root: ParentNode, options: VgplotProviderOptions): CollectedInput[] {
  /**
   * VGPlot inputs (Menu/Slider/etc.) are not plot interactors, but they are part
   * of the semantic interaction surface.
   *
   * The shared input base assigns `element.value = this`, so we can locate
   * and control widgets without depending on VGPlot types at build time.
   */
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.input'));
  const out: CollectedInput[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const inst = (el as { value?: unknown }).value;

    if (!inst || typeof inst !== 'object') continue;
    const input = inst as VgplotInputLike;
    const kind = input.constructor?.name ?? 'Input';

    const label =
      (typeof input.label === 'string' && input.label) || el.querySelector('label')?.textContent?.trim() || undefined;

    const inputId = String(i);
    const ref = makeViewRef({ appId: options.appId, viewId: options.viewId, suffix: `/input/${inputId}` });
    const menuOptions = /menu/i.test(kind) ? collectMenuOptions(input) : null;
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
        options: menuOptions?.options,
        optionsCount: menuOptions?.count,
        optionsTruncated: menuOptions?.truncated,
      },
    });
  }

  return out;
}

export function prepareInputAction(input: CollectedInput, call: { name: string; params?: unknown }) {
  const params = (call.params ?? {}) as Record<string, unknown>;
  const inst = input.input;

  if (call.name === 'vgplot.clear_input')
    return async () => {
      if (typeof inst.reset === 'function') {
        inst.reset();
        const next = ensureSelectedOption(inst);

        if (typeof inst.publish === 'function') inst.publish(next ?? null);
        await waitForInputDispatch(inst);

        return { cleared: true, value: next };
      }

      if (isSelectionLike(inst.selection)) {
        inst.selection.update({ source: inst });
        await waitForInputDispatch(inst);

        return { cleared: true, value: undefined };
      }

      if (isParamLike(inst.selection)) {
        inst.selection.update(null);
        await waitForInputDispatch(inst);

        return { cleared: true, value: null };
      }

      const next = ensureSelectedOption(inst);

      if (typeof inst.publish === 'function') inst.publish(next ?? null);
      await waitForInputDispatch(inst);

      return { cleared: true, value: next };
    };

  if (call.name === 'vgplot.set_input_option_index') {
    if (!hasIndexedOptions(input)) throw new Error('Input does not expose indexed options');
    const idx = Number(params.index);

    if (!Number.isInteger(idx)) throw new Error('index must be an integer');

    if (idx < 0) throw new Error('index must be >= 0');
    const count = optionCount(inst);

    if (idx >= count) throw new Error(`index must be < ${count}`);

    const next = structuredClone(optionValueAt(inst, idx));
    return async () => {
      if (inst.select && typeof inst.select.selectedIndex === 'number') inst.select.selectedIndex = idx;
      if (typeof inst.publish === 'function') inst.publish(next);
      await waitForInputDispatch(inst);

      return { set: true, index: idx, value: next };
    };
  }

  if (call.name === 'vgplot.set_input_value') {
    const searchbox = inst.searchbox;
    if (searchbox && typeof params.value !== 'string') throw new Error('Search value must be a string');
    const value = inst.slider ? coerceFiniteSliderValue(inst, params.value) : params.value;
    return async () => {
      if (inst.searchbox !== searchbox) throw new Error('Search input binding changed; prepare again');
      if (inst.slider) setSliderDomValue(inst, Number(value));
      if (searchbox) searchbox.value = String(value);

      if (typeof inst.selectedValue === 'function') inst.selectedValue(value);
      selectMenuValue(inst, value);

      if (typeof inst.publish === 'function') inst.publish(value);
      await waitForInputDispatch(inst);

      return { set: true, value };
    };
  }

  throw new Error(`Unsupported input action: ${call.name}`);
}
