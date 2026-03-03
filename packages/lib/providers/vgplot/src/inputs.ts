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
    const obj = v as object;
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

function safeJsonValue(value: unknown): unknown {
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

  // Prefer the rendered <select> options (includes auto-populated menus).
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

  // Fallback to VGPlot's `data` array (often present for explicit menu options).
  if (Array.isArray(input.data)) {
    const count = input.data.length;
    const sliced = input.data.slice(0, limit);
    return {
      options: sliced.map((o) => normalized(o.value, o.label)),
      count,
      truncated: count > limit,
    };
  }

  return null;
}

export function collectInputs(root: ParentNode, options: InstallVacpOnVgplotDashboardOptions): CollectedInput[] {
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
    const el = nodes[i] as VgplotInputElement;
    const inst = (el as unknown as { value?: unknown }).value;
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

export async function executeInputAction(
  input: CollectedInput,
  call: { name: string; params?: unknown },
): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inst = input.input as any;

  if (call.name === 'vgplot.clear_input') {
    if (typeof inst.reset === 'function') inst.reset();
    if (typeof inst.publish === 'function') inst.publish('');
    return { cleared: true };
  }

  if (call.name === 'vgplot.set_input_option_index') {
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

  if (call.name === 'vgplot.set_input_value') {
    const value = params.value;
    if (typeof inst.selectedValue === 'function') inst.selectedValue(value);
    if (inst.select) inst.select.value = String(value);
    if (typeof inst.publish === 'function') inst.publish(value);
    return { set: true, value };
  }

  throw new Error(`Unsupported input action: ${call.name}`);
}
