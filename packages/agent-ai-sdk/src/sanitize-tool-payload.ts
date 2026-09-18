const MAX_DEPTH = 8;

const MAX_ARRAY_ITEMS = 500;

const MAX_OBJECT_ENTRIES = 160;

const MAX_TYPED_ARRAY_BYTES = 512;

const MAX_STRING_LENGTH = 12_000;

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;

  return `${value.slice(0, MAX_STRING_LENGTH)}... [truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function sanitizeObjectEntries(
  value: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const entries = Object.entries(value);

  for (const [key, entry] of entries.slice(0, MAX_OBJECT_ENTRIES)) {
    const next = sanitizeToolPayloadInternal(entry, seen, depth + 1);

    if (next !== undefined) sanitized[key] = next;
  }

  if (entries.length > MAX_OBJECT_ENTRIES) {
    sanitized.__truncated = `${entries.length - MAX_OBJECT_ENTRIES} more keys`;
  }

  return sanitized;
}

function sanitizeError(value: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
  return sanitizeObjectEntries(
    {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: 'cause' in value ? value.cause : undefined,
    },
    seen,
    depth,
  );
}

function sanitizeToolPayloadInternal(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null) return null;

  if (value === undefined) return undefined;

  if (depth > MAX_DEPTH) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;

    if (typeof value === 'object') return `[${value.constructor?.name ?? 'Object'}]`;
  }

  switch (typeof value) {
    case 'string':
      return truncateString(value);
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
  }

  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;

  if (value instanceof Error) return sanitizeError(value, seen, depth);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeToolPayloadInternal(entry, seen, depth + 1) ?? null);

    return value.length > MAX_ARRAY_ITEMS
      ? [...items, { __truncated: `${value.length - MAX_ARRAY_ITEMS} more items` }]
      : items;
  }

  if (value instanceof Set) {
    const items = Array.from(value).slice(0, MAX_ARRAY_ITEMS);
    const sanitized = items.map((entry) => sanitizeToolPayloadInternal(entry, seen, depth + 1) ?? null);

    return value.size > MAX_ARRAY_ITEMS
      ? [...sanitized, { __truncated: `${value.size - MAX_ARRAY_ITEMS} more items` }]
      : sanitized;
  }

  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    const entries = Array.from(value.entries());

    for (const [key, entry] of entries.slice(0, MAX_OBJECT_ENTRIES)) {
      const next = sanitizeToolPayloadInternal(entry, seen, depth + 1);

      if (next !== undefined) result[String(key)] = next;
    }

    if (entries.length > MAX_OBJECT_ENTRIES) result.__truncated = `${entries.length - MAX_OBJECT_ENTRIES} more keys`;

    return result;
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const out = Array.from(bytes.slice(0, MAX_TYPED_ARRAY_BYTES));

    return bytes.length > MAX_TYPED_ARRAY_BYTES
      ? [...out, { __truncated: `${bytes.length - MAX_TYPED_ARRAY_BYTES} more bytes` }]
      : out;
  }

  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    const out = Array.from(bytes.slice(0, MAX_TYPED_ARRAY_BYTES));

    return bytes.length > MAX_TYPED_ARRAY_BYTES
      ? [...out, { __truncated: `${bytes.length - MAX_TYPED_ARRAY_BYTES} more bytes` }]
      : out;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    try {
      if ('toJSON' in value && typeof value.toJSON === 'function') {
        return sanitizeToolPayloadInternal((value as { toJSON: () => unknown }).toJSON(), seen, depth + 1);
      }

      return sanitizeObjectEntries(value as Record<string, unknown>, seen, depth);
    } finally {
      seen.delete(value);
    }
  }

  return undefined;
}

export function sanitizeToolPayload(value: unknown) {
  return sanitizeToolPayloadInternal(value, new WeakSet<object>(), 0);
}
