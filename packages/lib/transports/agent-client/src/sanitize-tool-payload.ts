function sanitizeObjectEntries(value: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const next = sanitizeToolPayloadInternal(entry, seen);
    if (next !== undefined) sanitized[key] = next;
  }
  return sanitized;
}

function sanitizeError(value: Error, seen: WeakSet<object>): Record<string, unknown> {
  return sanitizeObjectEntries(
    {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: 'cause' in value ? (value as { cause?: unknown }).cause : undefined,
    },
    seen,
  );
}

function sanitizeToolPayloadInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  switch (typeof value) {
    case 'string':
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

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeError(value, seen);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeToolPayloadInternal(entry, seen) ?? null);
  }
  if (value instanceof Set) {
    return Array.from(value, (entry) => sanitizeToolPayloadInternal(entry, seen) ?? null);
  }
  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      const next = sanitizeToolPayloadInternal(entry, seen);
      if (next !== undefined) result[String(key)] = next;
    }
    return result;
  }
  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    try {
      if (typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
        return sanitizeToolPayloadInternal((value as { toJSON: () => unknown }).toJSON(), seen);
      }

      return sanitizeObjectEntries(value as Record<string, unknown>, seen);
    } finally {
      seen.delete(value);
    }
  }

  return undefined;
}

export function sanitizeToolPayload(value: unknown): unknown {
  return sanitizeToolPayloadInternal(value, new WeakSet<object>());
}
