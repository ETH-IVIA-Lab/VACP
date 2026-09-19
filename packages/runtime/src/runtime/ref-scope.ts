/** Exact ref and slash-delimited ancestors, matching the protocol's prefix boundary. */
export function* refAncestors(ref: string): Generator<string> {
  yield ref;
  for (let end = ref.lastIndexOf('/'); end >= 0; end = ref.lastIndexOf('/', end - 1)) {
    yield ref.slice(0, end);
    if (end === 0) break;
  }
}

export function matchesRefScope(ref: string, scope: ReadonlySet<string>): boolean {
  for (const ancestor of refAncestors(ref)) if (scope.has(ancestor)) return true;
  return false;
}
