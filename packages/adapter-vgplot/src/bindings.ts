import type { VacpRef } from '@vacp/protocol';
import { plotLegends } from './legends.js';
import { makePlotRef } from './refs.js';
import type { CollectedInput } from './inputs.js';
import type {
  VgplotInteractorLike,
  VgplotLegendLike,
  VgplotPlotLike,
  VgplotProviderOptions,
  VgplotTableLike,
} from './types.js';

type PlotBinding = { kind: 'plot'; ref: VacpRef; plotId: string; plot: VgplotPlotLike };
type TableBinding = { kind: 'table'; ref: VacpRef; tableId: string; table: VgplotTableLike };
type InteractorBinding = {
  kind: 'interactor';
  ref: VacpRef;
  plot: VgplotPlotLike;
  interactor: VgplotInteractorLike;
  index: number;
};
type LegendBinding = { kind: 'legend'; ref: VacpRef; plot: VgplotPlotLike; legend: VgplotLegendLike; index: number };
type InputBinding = { kind: 'input'; ref: VacpRef; input: CollectedInput };
export type VgplotBinding = PlotBinding | TableBinding | InteractorBinding | LegendBinding | InputBinding;

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
  return {
    byRef,
    plots: [...plots.values()],
    tables: [...tables.values()],
    inputs: args.inputs,
    interactors: (plot: VgplotPlotLike) => interactors.get(plot) ?? [],
    legends: (plot: VgplotPlotLike) => legends.get(plot) ?? [],
    plot(id: unknown) {
      const binding = typeof id === 'string' && id ? plots.get(id) : plots.values().next().value;
      if (!binding) throw new Error(`Unknown plotId: ${String(id)}`);
      return binding;
    },
    table(id: unknown) {
      const binding = typeof id === 'string' && id ? tables.get(id) : tables.values().next().value;
      if (!binding) throw new Error(`Unknown tableId: ${String(id)}`);
      return binding;
    },
    input(ref: unknown) {
      const binding = typeof ref === 'string' ? byRef.get(ref as VacpRef) : undefined;
      if (binding?.kind !== 'input') throw new Error(`Unknown input ref: ${String(ref)}`);
      return binding;
    },
    interactor(plot: VgplotPlotLike, id: unknown) {
      const index = Number(id);
      const binding = Number.isInteger(index) && index >= 0 ? interactors.get(plot)?.[index] : undefined;
      if (!binding || plot.interactors[index] !== binding.interactor)
        throw new Error(`Unknown interactorId: ${String(id)}`);
      return binding;
    },
    legend(plot: VgplotPlotLike, channel: unknown) {
      const binding = legends
        .get(plot)
        ?.find(
          ({ legend }) =>
            legend.handler?.constructor.name === 'Toggle' &&
            (channel === undefined ||
              channel === null ||
              channel === '' ||
              (typeof channel === 'string' && legend.channel.toLowerCase() === channel.toLowerCase())),
        );
      if (!binding) throw new Error(`No interactive toggle legend for channel: ${String(channel)}`);
      return binding;
    },
  };
}
export type VgplotBindings = ReturnType<typeof createVgplotBindings>;
