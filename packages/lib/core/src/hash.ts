export function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mod = 0xffffffffffffffffn;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & mod;
  }
  return hash.toString(16).padStart(16, '0');
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v;
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
  return JSON.stringify(walk(value));
}
