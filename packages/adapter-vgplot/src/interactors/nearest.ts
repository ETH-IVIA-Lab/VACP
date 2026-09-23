import { preparePointSelection } from './toggle';
import { interactorType } from '../native-classes';
import type { VgplotInteractorLike } from '../types';

type SelectionBackedNearest = VgplotInteractorLike & {
  selection: { update(value: unknown): unknown; predicate(...args: unknown[]): unknown };
  clause(value: unknown): unknown;
};

/** Nearest can publish to a Param instead of a Selection; only a Selection-backed one is controllable. */
export function isSelectionBackedNearest(interactor: VgplotInteractorLike): interactor is SelectionBackedNearest {
  return (
    interactorType(interactor) === 'Nearest' &&
    typeof interactor.selection?.predicate === 'function' &&
    typeof interactor.selection.update === 'function' &&
    typeof interactor.clause === 'function'
  );
}

export function prepareNearestClear(interactor: VgplotInteractorLike) {
  if (!isSelectionBackedNearest(interactor))
    throw new Error('Nearest interactor is param-backed and cannot be controlled through semantic actions');
  return preparePointSelection(interactor, null);
}
