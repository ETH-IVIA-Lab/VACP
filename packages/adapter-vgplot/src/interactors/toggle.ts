import type { VgplotInteractorLike } from '../types.js';

function isSqlLiteralLike(value: unknown): boolean {
  return (
    value == null ||
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function assertTogglePoints(points: unknown[][] | null): void {
  if (!points) return;

  for (const row of points) {
    if (!Array.isArray(row)) throw new Error('Expected toggle points to be an array of arrays');

    for (const v of row) {
      if (!isSqlLiteralLike(v)) {
        throw new Error(`Unsupported toggle value type: ${Object.prototype.toString.call(v)}`);
      }
    }
  }
}

/** Toggle and region selections share tuple normalization and validated mutation. */
export function preparePointSelection(interactor: VgplotInteractorLike, raw: unknown) {
  const points =
    raw == null || (Array.isArray(raw) && raw.length === 0)
      ? null
      : Array.isArray(raw) && Array.isArray(raw[0])
        ? raw
        : Array.isArray(raw)
          ? raw.map((value) => [value])
          : [[raw]];
  assertTogglePoints(points);
  const selection = interactor.selection;
  const update = selection?.update;
  const clause = interactor.clause;
  if (!update || !clause) throw new Error('Selection is missing selection.update/clause');
  return () => {
    if (interactor.selection !== selection) throw new Error('Selection binding changed; prepare again');
    interactor.value = points;
    update.call(selection, clause.call(interactor, points));
    return points ? { set: true } : { cleared: true };
  };
}
