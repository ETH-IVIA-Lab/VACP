import type { VegaViewLike } from './types';

export type SelectionTuple = { unit?: string } & (
  | { fields: unknown[]; values: unknown[]; _vgsid_?: never }
  | { _vgsid_: number; fields?: never; values?: never }
);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** One serializable representation of the native selection relation for capture and preparation. */
export function selectionTuple(value: unknown, defaultUnit?: string): SelectionTuple | null {
  if (!record(value)) return null;
  const name = value.unit ?? defaultUnit;
  if (name !== undefined && typeof name !== 'string') throw new Error('Invalid selection unit');
  const unit = typeof name === 'string' ? { unit: name } : {};
  if (Object.hasOwn(value, 'fields') || Object.hasOwn(value, 'values')) {
    if (!Array.isArray(value.fields) || !Array.isArray(value.values) || value.fields.length !== value.values.length)
      throw new Error('Selection fields and values must have matching lengths');
    const fields = value.fields.map((field: unknown) => {
      if (!record(field) || typeof field.field !== 'string' || typeof field.type !== 'string')
        throw new Error('Invalid selection field');
      return {
        field: field.field,
        type: field.type,
        ...(typeof field.channel === 'string' ? { channel: field.channel } : {}),
      };
    });
    return { ...unit, fields, values: structuredClone(value.values) };
  }
  if (typeof value._vgsid_ === 'number' && Number.isFinite(value._vgsid_)) return { ...unit, _vgsid_: value._vgsid_ };
  return null;
}

/** Retain only selection tuples, never arbitrary Vega data or signal state. */
export function readSelectionTuples(view: VegaViewLike, name: string): SelectionTuple[] | undefined {
  if (!view.data) return undefined;
  let rows: unknown;
  try {
    rows = view.data(`${name}_store`);
  } catch {
    return undefined;
  }
  if (!Array.isArray(rows)) return undefined;
  return rows.map((row) => {
    const tuple = selectionTuple(row);
    if (!tuple) throw new Error('Unknown native selection tuple');
    return tuple;
  });
}

/** Resolved point fields are marginal sets; vlPoint retains their actual tuple correlations. */
export function selectionValues(value: unknown): unknown[] {
  if (record(value) && Object.hasOwn(value, 'vlPoint')) {
    if (!record(value.vlPoint) || !Array.isArray(value.vlPoint.or))
      throw new Error('Resolved intersected point selections require captured native tuples');
    return value.vlPoint.or;
  }
  return Array.isArray(value) ? value : [value];
}
