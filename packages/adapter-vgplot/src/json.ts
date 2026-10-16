export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function jsonValue(value: unknown, ancestors = new Set<object>()): JsonValue | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Selection contains a non-finite number');
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') throw new TypeError('Selection contains a non-JSON value');
  if (ancestors.has(value)) throw new TypeError('Selection contains a cycle');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, ancestors) ?? null);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError('Selection contains a non-JSON object');
    const entries: [string, JsonValue][] = [];
    for (const [key, entry] of Object.entries(value)) {
      const captured = jsonValue(entry, ancestors);
      if (captured !== undefined) entries.push([key, captured]);
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}
