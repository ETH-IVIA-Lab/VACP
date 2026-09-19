import { preparePointSelection } from './toggle';
import type { VgplotInteractorLike } from '../types';

type SelectionBackedNearest = VgplotInteractorLike & {
  selection: { update(value: unknown): unknown; predicate(...args: unknown[]): unknown };
  clause(value: unknown): unknown;
};

export function isSelectionBackedNearest(interactor: VgplotInteractorLike): interactor is SelectionBackedNearest {
  if (!interactor || typeof interactor !== 'object') return false;

  const candidate = interactor;

  return (
    candidate.constructor?.name === 'Nearest' &&
    typeof candidate.selection?.predicate === 'function' &&
    typeof candidate.selection.update === 'function' &&
    typeof candidate.clause === 'function'
  );
}

export function prepareNearestClear(interactor: VgplotInteractorLike) {
  if (!isSelectionBackedNearest(interactor))
    throw new Error('Nearest interactor is param-backed and cannot be controlled through semantic actions');
  return preparePointSelection(interactor, null);
}
