export type JsonPath = Array<string | number>;
export type JsonContainer = Record<string, unknown> | unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonContainer(value: unknown): value is JsonContainer {
  return Array.isArray(value) || isRecord(value);
}

export function toJsonContainer(value: unknown): JsonContainer {
  return isJsonContainer(value) ? value : {};
}

function parseArrayIndex(segment: string | number): number {
  if (typeof segment === 'number') {
    if (!Number.isInteger(segment) || segment < 0) throw new Error(`Expected an array index, received "${segment}".`);
    return segment;
  }
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new Error(`Expected an array index, received "${segment}".`);
  return Number(segment);
}

function parsePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function createContainerFor(nextSegment: string | number | undefined): JsonContainer {
  if (typeof nextSegment === 'number') return [];
  if (typeof nextSegment === 'string' && /^(0|[1-9]\d*)$/.test(nextSegment)) return [];
  return {};
}

export function parseJsonEditorPath(input: string): JsonPath {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('/')) return [trimmed];
  return trimmed.slice(1).split('/').map(parsePointerSegment);
}

export function setJsonPath(root: unknown, path: JsonPath, nextValue: unknown): JsonContainer {
  const base = toJsonContainer(root);
  if (path.length === 0) {
    if (!isJsonContainer(nextValue)) throw new Error('The root value must be a JSON object or array.');
    return nextValue;
  }

  function setAt(current: unknown, remaining: JsonPath): unknown {
    if (remaining.length === 0) return nextValue;
    const [head, ...tail] = remaining;
    if (Array.isArray(current)) {
      const index = parseArrayIndex(head);
      if (index > current.length) throw new Error(`Array index ${index} cannot skip past length ${current.length}.`);
      const copy = current.slice();
      copy[index] = setAt(copy[index] ?? createContainerFor(tail[0]), tail);
      return copy;
    }
    const object = isRecord(current) ? current : {};
    const key = String(head);
    return {
      ...object,
      [key]: setAt(object[key] ?? createContainerFor(tail[0]), tail),
    };
  }

  const updated = setAt(base, path);
  if (!isJsonContainer(updated)) throw new Error('The edited value must stay a JSON object or array.');
  return updated;
}

export function deleteJsonPath(root: unknown, path: JsonPath): JsonContainer {
  const base = toJsonContainer(root);
  if (path.length === 0) throw new Error('The root value cannot be deleted.');

  function deleteAt(current: unknown, remaining: JsonPath): unknown {
    const [head, ...tail] = remaining;
    if (Array.isArray(current)) {
      const index = parseArrayIndex(head);
      if (index < 0 || index >= current.length) throw new Error(`Array index ${index} does not exist.`);
      if (tail.length === 0) return current.filter((_, idx) => idx !== index);
      const copy = current.slice();
      copy[index] = deleteAt(copy[index], tail);
      return copy;
    }
    if (!isRecord(current)) throw new Error(`Path segment "${String(head)}" does not exist.`);
    const key = String(head);
    if (!(key in current)) throw new Error(`Path segment "${key}" does not exist.`);
    if (tail.length === 0) {
      const { [key]: _deleted, ...rest } = current;
      return rest;
    }
    return {
      ...current,
      [key]: deleteAt(current[key], tail),
    };
  }

  const updated = deleteAt(base, path);
  if (!isJsonContainer(updated)) throw new Error('The edited value must stay a JSON object or array.');
  return updated;
}

export function renameJsonKey(root: unknown, path: JsonPath, nextKey: string): JsonContainer {
  const cleanKey = nextKey.trim();
  if (!cleanKey) throw new Error('JSON object keys cannot be empty.');
  if (path.length === 0) throw new Error('The root key cannot be renamed.');
  const parentPath = path.slice(0, -1);
  const currentKey = path[path.length - 1];
  if (typeof currentKey === 'number') throw new Error('Array indexes cannot be renamed.');

  function renameAt(current: unknown, remaining: JsonPath): unknown {
    if (remaining.length > 0) {
      const [head, ...tail] = remaining;
      if (Array.isArray(current)) {
        const index = parseArrayIndex(head);
        if (index >= current.length) throw new Error(`Array index ${index} does not exist.`);
        const copy = current.slice();
        copy[index] = renameAt(copy[index], tail);
        return copy;
      }
      if (!isRecord(current)) throw new Error(`Path segment "${String(head)}" does not exist.`);
      const key = String(head);
      return {
        ...current,
        [key]: renameAt(current[key], tail),
      };
    }
    if (!isRecord(current) || Array.isArray(current)) throw new Error('Only object keys can be renamed.');
    const oldKey = String(currentKey);
    if (!(oldKey in current)) throw new Error(`Path segment "${oldKey}" does not exist.`);
    if (cleanKey !== oldKey && cleanKey in current) throw new Error(`JSON object already has key "${cleanKey}".`);
    const renamed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
      renamed[key === oldKey ? cleanKey : key] = value;
    }
    return renamed;
  }

  const updated = renameAt(toJsonContainer(root), parentPath);
  if (!isJsonContainer(updated)) throw new Error('The edited value must stay a JSON object or array.');
  return updated;
}

export function parseJsonLiteral(input: string): unknown {
  return JSON.parse(input);
}

export function formatJsonLiteral(value: unknown): string {
  return JSON.stringify(value);
}
