/** Freeze ordinary data graphs; built-in mutable containers require isolated delivery. */
function freezeShareable(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  let shareable = true;
  for (const entry of Object.values(value)) if (!freezeShareable(entry, seen)) shareable = false;
  Object.freeze(value);
  return shareable;
}

/**
 * Capture once. Ordinary records and arrays are shared as deeply frozen facts.
 * A mutable built-in value, such as a Date or typed array, gets an isolated copy per read.
 */
export function captureVacpValue<Value>(input: Value): () => Value {
  const value = structuredClone(input);
  const shareable = freezeShareable(value, new WeakSet());
  return shareable ? () => value : () => structuredClone(value);
}
