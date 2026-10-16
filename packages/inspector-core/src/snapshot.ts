import type { InspectionSnapshot } from './types';

/** Capture JSON-shaped payloads, preserving undefined and serializing dates. */
export function snapshot<T>(value: T): InspectionSnapshot<T> {
  const ancestors = new Set<object>();
  const capture = (value: unknown, path: string): unknown => {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`Cannot capture ${path}: use a finite number or null`);
      return value;
    }
    if (value instanceof Date) return value.toJSON();
    if (typeof value !== 'object') throw new TypeError(`Cannot capture ${path}: use JSON-shaped values`);
    if (ancestors.has(value)) throw new TypeError(`Cannot capture ${path}: remove the circular reference`);
    const array = Array.isArray(value);
    if (!array) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError(`Cannot capture ${path}: convert the value to a plain record or array`);
    }
    ancestors.add(value);
    let copy: unknown;
    if (array) {
      copy = value.map((item, index) => capture(item, `${path}[${index}]`));
    } else {
      const record: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const captured = capture(child, `${path}.${key}`);
        // Preserve this as data, rather than invoking Object.prototype's setter.
        if (key === '__proto__') Object.defineProperty(record, key, { value: captured, enumerable: true });
        else record[key] = captured;
      }
      copy = record;
    }
    ancestors.delete(value);
    return Object.freeze(copy);
  };
  return capture(value, '$') as InspectionSnapshot<T>;
}
