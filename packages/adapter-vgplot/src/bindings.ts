import type { VacpRef } from '@vacp/protocol';
import { plotLegends } from './legends';
import { makePlotRef, makeViewRef } from './refs';
import type { CollectedInput } from './inputs';
import { interactorType, type VgplotInteractorType } from './native-classes';
import type {
  VgplotSelectionLike,
  VgplotInteractorLike,
  VgplotLegendLike,
  VgplotPlotLike,
  VgplotProviderOptions,
  VgplotTableLike,
} from './types';

type PlotBinding = { kind: 'plot'; ref: VacpRef; plotId: string; plot: VgplotPlotLike };
type TableBinding = { kind: 'table'; ref: VacpRef; tableId: string; table: VgplotTableLike };
type InteractorBinding = {
  kind: 'interactor';
  ref: VacpRef;
  plot: VgplotPlotLike;
  interactor: VgplotInteractorLike;
  /** Undefined for interactors that are not Mosaic classes, such as application extensions. */
  type: VgplotInteractorType | undefined;
  index: number;
};
type LegendBinding = { kind: 'legend'; ref: VacpRef; plot: VgplotPlotLike; legend: VgplotLegendLike; index: number };
type InputBinding = { kind: 'input'; ref: VacpRef; input: CollectedInput };
export type VgplotBinding = PlotBinding | TableBinding | InteractorBinding | LegendBinding | InputBinding;

/** Mosaic Selection.value is the latest shared clause, not necessarily this source's clause. */
export function readInteractorSelection(interactor: VgplotInteractorLike | undefined): unknown {
  const selection = interactor?.selection;
  return selection?.valueFor && interactor
    ? (selection.valueFor(interactor) ?? null)
    : (selection?.value ?? interactor?.value ?? null);
}

/** Native identities for one provider generation. No consumer decodes reference paths. */
export function createVgplotBindings(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables: Array<{ tableId: string; table: VgplotTableLike }>;
  inputs: CollectedInput[];
  options: VgplotProviderOptions;
}) {
  const byRef = new Map<VacpRef, VgplotBinding>();
  const plots = new Map<string, PlotBinding>();
  const tables = new Map<string, TableBinding>();
  const interactors = new WeakMap<VgplotPlotLike, InteractorBinding[]>();
  const legends = new WeakMap<VgplotPlotLike, LegendBinding[]>();
  const add = (binding: VgplotBinding) => {
    if (byRef.has(binding.ref)) throw new Error(`Duplicate VGPlot binding: ${binding.ref}`);
    byRef.set(binding.ref, binding);
  };
  for (const { plotId, plot } of args.plots) {
    const ref = makePlotRef({ ...args.options, plotId, suffix: '' });
    const binding: PlotBinding = { kind: 'plot', ref, plotId, plot };
    plots.set(plotId, binding);
    add(binding);
    interactors.set(
      plot,
      plot.interactors.map((interactor, index) => {
        const target: InteractorBinding = {
          kind: 'interactor',
          ref: `${ref}/interactor/${index}`,
          plot,
          interactor,
          type: interactorType(interactor),
          index,
        };
        add(target);
        return target;
      }),
    );
    legends.set(
      plot,
      plotLegends(plot).map((legend, index) => {
        const target: LegendBinding = { kind: 'legend', ref: `${ref}/legend/${index}`, plot, legend, index };
        add(target);
        return target;
      }),
    );
  }
  for (const { tableId, table } of args.tables) {
    const binding: TableBinding = {
      kind: 'table',
      ref: makePlotRef({ ...args.options, plotId: tableId, suffix: '' }),
      tableId,
      table,
    };
    tables.set(tableId, binding);
    add(binding);
  }
  for (const input of args.inputs) add({ kind: 'input', ref: input.ref, input });
  // Mosaic's active clause changes crossfilter rendering, even when every clause value is unchanged.
  const selections = new Map<
    VgplotSelectionLike,
    { ref: VacpRef; selection: VgplotSelectionLike; sources: Map<VacpRef, object> }
  >();
  for (const binding of byRef.values()) {
    const source =
      binding.kind === 'interactor'
        ? binding.interactor
        : binding.kind === 'legend'
          ? binding.legend.handler
          : binding.kind === 'input'
            ? binding.input.input
            : binding.kind === 'table'
              ? binding.table
              : undefined;
    const selection = source?.selection;
    if (!selection || !('active' in selection)) continue;
    let group = selections.get(selection);
    if (!group) {
      group = {
        ref: makeViewRef({ ...args.options, suffix: `/selection/${selections.size}` }),
        selection,
        sources: new Map(),
      };
      selections.set(selection, group);
    }
    group.sources.set(binding.ref, source);
  }
  return {
    byRef,
    selections: [...selections.values()],
    plots: [...plots.values()],
    tables: [...tables.values()],
    inputs: args.inputs,
    interactors: (plot: VgplotPlotLike) => interactors.get(plot) ?? [],
    legends: (plot: VgplotPlotLike) => legends.get(plot) ?? [],
  };
}
export type VgplotBindings = ReturnType<typeof createVgplotBindings>;
