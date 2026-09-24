export function fnv1a64Hex(value: string): string {
  let high = 0xcbf29ce4;
  let low = 0x84222325;

  // Multiply two 32-bit limbs by 2^40 + 435, modulo 2^64. The low
  // product stays below 2^41, so its carry is exact in a JavaScript number.
  // Keep hashing UTF-16 code units to preserve existing protocol tokens.
  for (let i = 0; i < value.length; i += 1) {
    low = (low ^ value.charCodeAt(i)) >>> 0;
    const product = low * 435;
    high = (Math.imul(high, 435) + (low << 8) + Math.floor(product / 0x100000000)) >>> 0;
    low = product >>> 0;
  }

  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}

export function stableStringify(value: unknown): string {
  // Normalize through JSON first so toJSON, omitted properties, and shared
  // references have exactly the same meaning as the serialized protocol data.
  const serialized = JSON.stringify(value);
  const walk = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object') return entry;
    if (Array.isArray(entry)) {
      for (let index = 0; index < entry.length; index++) entry[index] = walk(entry[index]);
      return entry;
    }
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(entry).sort()) sorted[key] = walk((entry as Record<string, unknown>)[key]);
    return sorted;
  };
  return JSON.stringify(walk(serialized === undefined ? undefined : JSON.parse(serialized)));
}

/** What JSON keeps of a value in an object: undefined, functions, and symbols are left out. */
const kept = (value: unknown) => value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';

/**
 * Whether two values have the same `stableStringify` form, compared in one pass without building
 * strings. Use it to detect change in large captured data, such as a graph between revisions.
 */
export function sameVacpValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // A value with its own JSON form, such as a Date, compares by that form.
  const custom = (value: unknown) => typeof (value as { toJSON?: unknown } | null)?.toJSON === 'function';
  if (custom(a) || custom(b)) return stableStringify(a) === stableStringify(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    const scalar = (value: unknown) =>
      !kept(value) ? undefined : typeof value === 'number' && !Number.isFinite(value) ? null : value;
    return scalar(a) === scalar(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    // Array holes, undefined, and functions all serialize as null.
    for (let index = 0; index < a.length; index++)
      if (!sameVacpValue(kept(a[index]) ? a[index] : null, kept(other[index]) ? other[index] : null)) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => kept(left[key]));
  if (keys.length !== Object.keys(right).filter((key) => kept(right[key])).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && sameVacpValue(left[key], right[key]));
}
