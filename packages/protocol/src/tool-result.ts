/** A JSON value, as a tool returns it to a model. */
export type VacpToolResult = string | number | boolean | null | VacpToolResult[] | { [key: string]: VacpToolResult };

/** How much of a value a tool result keeps. */
export type VacpToolResultLimits = {
  /** Arrays and objects nested deeper than this below the result are summarized. */
  depth: number;
  /** Array items kept, counting the marker a cut array ends with. */
  items: number;
  /** Object keys kept, counting the marker key a cut object ends with. */
  keys: number;
  /** String characters kept, counted as Unicode code points and counting a cut string's marker. */
  characters: number;
};

export const VACP_TOOL_RESULT_LIMITS: VacpToolResultLimits = { depth: 32, items: 500, keys: 160, characters: 12_000 };

type Open = WeakSet<object>;

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

const isTypedArray = (value: unknown): value is TypedArray => ArrayBuffer.isView(value) && !(value instanceof DataView);

/** Values JSON leaves out of objects. Arrays keep their place as null. */
const omitted = (value: unknown) => value === undefined || typeof value === 'function' || typeof value === 'symbol';

const surrogatePair = (text: string, at: number) => {
  const high = text.charCodeAt(at);
  const low = text.charCodeAt(at + 1);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
};

function codePoints(text: string): number {
  let count = 0;
  for (let at = 0; at < text.length; at += surrogatePair(text, at) ? 2 : 1) count++;
  return count;
}

/** The UTF-16 index where `text`'s first `points` code points end. */
function codePointEnd(text: string, points: number): number {
  let at = 0;
  for (let count = 0; count < points && at < text.length; count++) at += surrogatePair(text, at) ? 2 : 1;
  return at;
}

const cutText = (count: number) => `... [${count} more characters]`;

/** `text`, or its first code points with a marker counting the rest, within `limit` code points in all. */
function text(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const total = codePoints(value);
  if (total <= limit) return value;
  let keep = Math.max(0, limit - cutText(total - limit).length);
  while (keep > 0 && keep + cutText(total - keep).length > limit) keep--;
  return `${value.slice(0, codePointEnd(value, keep))}${cutText(total - keep)}`;
}

/** The head of a collection of `size` items, and the marker that ends it when it is cut. */
function cut(size: number, limit: number, head: (count: number) => unknown[]) {
  const keep = size > limit ? Math.max(0, limit - 1) : size;
  return { items: head(keep), rest: size - keep };
}

function list(
  size: number,
  head: (count: number) => unknown[],
  depth: number,
  limits: VacpToolResultLimits,
  open: Open,
): VacpToolResult {
  if (depth > limits.depth) return `[Array(${size})]`;
  const { items, rest } = cut(size, limits.items, head);
  const result = items.map((item) => bound(item, depth + 1, limits, open));
  if (rest) result.push(`[${rest} more items]`);
  return result;
}

function record(
  entries: Iterable<readonly [string, unknown]>,
  depth: number,
  limits: VacpToolResultLimits,
  open: Open,
): VacpToolResult {
  if (depth > limits.depth) return '[Object]';
  const kept: Array<[string, unknown]> = [];
  let size = 0;
  for (const [key, value] of entries) {
    if (omitted(value)) continue;
    if (kept.length < limits.keys) kept.push([key, value]);
    size++;
  }
  const { items, rest } = cut(size, limits.keys, (count) => kept.slice(0, count));
  const result = (items as Array<[string, unknown]>).map(([key, value]) => [
    key,
    bound(value, depth + 1, limits, open),
  ]);
  if (rest) result.push(['__truncated', `${rest} more keys`]);
  // Built from pairs, so a `__proto__` key stays an own key.
  return Object.fromEntries(result) as VacpToolResult;
}

function* ownEntries(value: Record<string, unknown>): Generator<[string, unknown]> {
  for (const key of Object.keys(value)) yield [key, value[key]];
}

function* mapEntries(map: Map<unknown, unknown>): Generator<[string, unknown]> {
  for (const [key, value] of map) yield [String(key), value];
}

function firstOf<Item>(items: Iterable<Item>, count: number): Item[] {
  const head: Item[] = [];
  for (const item of items) {
    if (head.length >= count) break;
    head.push(item);
  }
  return head;
}

/** A native value as the JSON it stands for, read only as far as the limits keep. */
function native(
  object: Record<string, unknown>,
  depth: number,
  limits: VacpToolResultLimits,
  open: Open,
  converted: boolean,
): VacpToolResult {
  if (object instanceof Date) return Number.isFinite(object.getTime()) ? object.toISOString() : null;
  if (Array.isArray(object)) return list(object.length, (count) => object.slice(0, count), depth, limits, open);
  if (object instanceof Set) return list(object.size, (count) => firstOf(object, count), depth, limits, open);
  if (object instanceof Map) return record(mapEntries(object), depth, limits, open);
  if (object instanceof ArrayBuffer || object instanceof DataView) {
    const [buffer, offset, length] =
      object instanceof ArrayBuffer
        ? [object, 0, object.byteLength]
        : [object.buffer, object.byteOffset, object.byteLength];
    const bytes = (count: number) => Array.from(new Uint8Array(buffer, offset, count));
    return list(length, bytes, depth, limits, open);
  }
  if (isTypedArray(object)) {
    const values = (count: number) => Array.from(object.subarray(0, count) as ArrayLike<number | bigint>);
    return list(object.length, values, depth, limits, open);
  }
  if (object instanceof Error)
    return record(
      Object.entries({
        name: object.name,
        message: object.message,
        ...('cause' in object ? { cause: object.cause } : {}),
      }),
      depth,
      limits,
      open,
    );
  // JSON calls a value's `toJSON` once and writes whatever it returns.
  if (!converted && typeof object.toJSON === 'function') {
    const json: unknown = object.toJSON();
    if (json !== object) return bound(json, depth, limits, open, true);
  }
  return record(ownEntries(object), depth, limits, open);
}

function bound(
  value: unknown,
  depth: number,
  limits: VacpToolResultLimits,
  open: Open,
  converted = false,
): VacpToolResult {
  if (value === null || omitted(value)) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return text(value, limits.characters);
  const object = value as Record<string, unknown>;
  if (open.has(object)) return '[circular]';
  open.add(object);
  try {
    return native(object, depth, limits, open, converted);
  } finally {
    open.delete(object);
  }
}

/**
 * `value` as JSON a model reads, bounded so one tool call cannot flood its context. A string keeps
 * `limits.characters` code points, an array `limits.items` items, and an object `limits.keys` keys,
 * each counting the marker that says what was cut: `... [n more characters]`, a `[n more items]`
 * item, or a `__truncated: "n more keys"` entry. Arrays and objects deeper than `limits.depth`
 * read as `[Array(n)]` or `[Object]`. A bounded value passes through unchanged. Dates, errors,
 * maps, sets, typed arrays, and `toJSON` values read as the JSON they stand for, and a value
 * inside itself reads as `[circular]`. `test/fixtures/tool-result.json` holds the cases the Python
 * server's `tool_result` shares.
 */
export function vacpToolResult(value: unknown, limits: VacpToolResultLimits = VACP_TOOL_RESULT_LIMITS): VacpToolResult {
  return bound(value, 0, limits, new WeakSet());
}
