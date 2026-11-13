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
