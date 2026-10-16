import { Query, and, duckDBCodeGenerator, isNode } from '@uwdata/mosaic-sql';

import { markTable } from './data-handles';
import type { VgplotPlotLike, VgplotSelectionLike, VgplotTableLike } from './types';

/**
 * The predicate that narrows `table` as the dashboard narrows it: the whole predicate of each
 * selection that filters a mark or table view reading `table`, as Mosaic's `filterBy`. Selections
 * that only highlight, or that filter views of other tables, leave `table` alone.
 */
function predicatesForTable(
  table: string,
  surfaces: { plots: readonly VgplotPlotLike[]; tables: readonly VgplotTableLike[] },
) {
  const selections = new Set<Pick<VgplotSelectionLike, 'predicate'>>();
  for (const plot of surfaces.plots)
    for (const mark of plot.marks) if (mark.filterBy && markTable(mark) === table) selections.add(mark.filterBy);
  for (const view of surfaces.tables) if (view.filterBy && view.from === table) selections.add(view.filterBy);
  const clauses = [...selections].flatMap((selection) => {
    if (!selection.predicate) throw new Error('Selection has no native SQL predicate');
    const predicate = selection.predicate(undefined, true);
    const terms = Array.isArray(predicate) ? predicate : predicate == null ? [] : [predicate];
    for (const term of terms) if (!isNode(term)) throw new Error('Selection returned an unsupported SQL predicate');
    return terms.filter(isNode);
  });
  return clauses;
}

export function whereClauseForVgplotTable(
  table: string,
  surfaces: { plots: readonly VgplotPlotLike[]; tables: readonly VgplotTableLike[] },
): string | null {
  const predicates = predicatesForTable(table, surfaces);
  return predicates.length ? duckDBCodeGenerator.toString(and(predicates)) : null;
}

export function selectedSqlForVgplotTable(
  table: string,
  surfaces: { plots: readonly VgplotPlotLike[]; tables: readonly VgplotTableLike[] },
): string {
  return Query.from(table).select('*').where(predicatesForTable(table, surfaces)).toString();
}
