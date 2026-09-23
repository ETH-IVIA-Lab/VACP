import type { VacpFocus, VacpInteraction, VacpActionExecutionOptions } from '@vacp/protocol';
import type { VgplotBinding, VgplotBindings } from './bindings';
import { prepareInputAction } from './inputs';
import { plotLegends } from './legends';
import { prepareInterval } from './interactors/interval';
import { prepareNearestClear } from './interactors/nearest';
import { preparePanZoom } from './interactors/pan-zoom';
import { requestPlotUpdate } from './native-observation';
import { preparePointSelection } from './interactors/toggle';
import { prepareTableAction } from './table-actions';
import { interactorType } from './native-classes';

type Params = Record<string, unknown>;
export type VgplotOperation = {
  focus: VacpFocus;
  execute(options?: VacpActionExecutionOptions): unknown | Promise<unknown>;
};
type Prepare = (params: Params) => VgplotOperation;

/** A closed native target plus a validated mutation; execution never resolves the target again. */
function bound(
  binding: VgplotBinding,
  execute: () => unknown | Promise<unknown>,
  detail?: unknown,
  interaction: VacpInteraction = { kind: 'activate' },
): VgplotOperation {
  return {
    focus: { ref: binding.ref, detail, interaction },
    execute: async (options = {}) => {
      options.signal?.throwIfAborted();
      if (binding.kind === 'interactor' && binding.plot.interactors[binding.index] !== binding.interactor)
        throw new Error('Interactor binding changed; prepare the operation again');
      if (binding.kind === 'legend' && plotLegends(binding.plot)[binding.index] !== binding.legend)
        throw new Error('Legend binding changed; prepare the operation again');
      const result = await execute();
      // Mosaic may queue selection events behind an earlier asynchronous update.
      // Wait for the native event boundary so the recorded controls include this operation.
      const selection =
        binding.kind === 'interactor'
          ? binding.interactor.selection
          : binding.kind === 'legend'
            ? binding.legend.handler?.selection
            : undefined;
      const pending = selection?.pending?.('value');
      if (pending) {
        const signal = options.signal;
        signal?.throwIfAborted();
        let abort = () => {};
        try {
          await (signal
            ? Promise.race([
                pending,
                new Promise<never>((_, reject) => {
                  abort = () => reject(signal.reason);
                  signal.addEventListener('abort', abort, { once: true });
                }),
              ])
            : pending);
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      }
      options.signal?.throwIfAborted();
      if ('plot' in binding) requestPlotUpdate(binding.plot);
      return result;
    },
  };
}

export function createVgplotOperations(bindings: VgplotBindings) {
  const interactor = (params: Params) => bindings.interactor(bindings.plot(params.plotId).plot, params.interactorId);
  const interval = (params: Params, dimension: 1 | 2, clear: boolean) => {
    const binding = interactor(params);
    const values = clear
      ? null
      : dimension === 1
        ? [params.min, params.max]
        : [params.x0, params.x1, params.y0, params.y1];
    const plan = prepareInterval(binding.interactor, dimension, values);
    return bound(
      binding,
      plan.execute,
      plan.detail,
      clear
        ? { kind: 'activate' }
        : { kind: 'brush', axis: dimension === 2 ? 'xy' : binding.interactor.channel === 'y' ? 'y' : 'x' },
    );
  };
  const points = (params: Params, kind: 'Toggle' | 'Region', clear: boolean) => {
    const binding = interactor(params);
    if (binding.type !== kind) throw new Error(`Expected ${kind} interactor`);
    return bound(
      binding,
      preparePointSelection(binding.interactor, clear ? null : params.value),
      undefined,
      !clear && kind === 'Region' ? { kind: 'brush' } : { kind: 'activate' },
    );
  };
  const legend = (params: Params, clear: boolean) => {
    const binding = bindings.legend(bindings.plot(params.plotId).plot, params.channel);
    const handler = binding.legend.handler;
    if (!handler) throw new Error('Legend has no writable toggle handler');
    return bound(binding, preparePointSelection(handler, clear ? null : params.value), {
      value: clear ? null : params.value,
    });
  };
  const table = (params: Params, name: string) => {
    const binding = bindings.table(params.tableId);
    return bound(binding, prepareTableAction(binding.table, { name, params }), {
      column: name === 'vgplot.table_set_page' ? undefined : (params.column ?? binding.table.sortColumn),
    });
  };
  const input = (params: Params, name: string) => {
    const binding = bindings.input(params.ref);
    return bound(
      binding,
      prepareInputAction(binding.input, { name, params }),
      undefined,
      name === 'vgplot.clear_input'
        ? { kind: 'activate' }
        : binding.input.input.slider
          ? { kind: 'drag', axis: 'x' }
          : binding.input.input.searchbox
            ? { kind: 'edit' }
            : { kind: 'activate' },
    );
  };
  const factories: Record<string, Prepare> = {
    'vgplot.set_interval_1d': (p) => interval(p, 1, false),
    'vgplot.clear_interval_1d': (p) => interval(p, 1, true),
    'vgplot.set_interval_2d': (p) => interval(p, 2, false),
    'vgplot.clear_interval_2d': (p) => interval(p, 2, true),
    'vgplot.set_toggle': (p) => points(p, 'Toggle', false),
    'vgplot.clear_toggle': (p) => points(p, 'Toggle', true),
    'vgplot.set_region': (p) => points(p, 'Region', false),
    'vgplot.clear_region': (p) => points(p, 'Region', true),
    'vgplot.set_legend_toggle': (p) => legend(p, false),
    'vgplot.clear_legend_toggle': (p) => legend(p, true),
    'vgplot.clear_nearest': (p) => {
      const b = interactor(p);
      return bound(b, prepareNearestClear(b.interactor), undefined, { kind: 'point' });
    },
    'vgplot.set_pan_zoom': (p) => {
      const b = interactor(p);
      const plan = preparePanZoom(b.interactor, p);
      return bound(b, plan.execute, undefined, plan.interaction);
    },
    'vgplot.clear_pan_zoom': (p) => {
      const b = interactor(p);
      const plan = preparePanZoom(b.interactor, null);
      return bound(b, plan.execute, undefined, plan.interaction);
    },
    'vgplot.table_set_sort': (p) => table(p, 'vgplot.table_set_sort'),
    'vgplot.table_clear_sort': (p) => table(p, 'vgplot.table_clear_sort'),
    'vgplot.table_set_page': (p) => table(p, 'vgplot.table_set_page'),
    'vgplot.set_input_option_index': (p) => input(p, 'vgplot.set_input_option_index'),
    'vgplot.set_input_value': (p) => input(p, 'vgplot.set_input_value'),
    'vgplot.clear_input': (p) => input(p, 'vgplot.clear_input'),
  };
  return {
    prepare(name: string, raw: unknown): VgplotOperation {
      const params = structuredClone(raw ?? {});
      if (typeof params !== 'object' || Array.isArray(params)) throw new Error('Expected action parameters');
      const prepare = Object.hasOwn(factories, name) ? factories[name] : undefined;
      if (!prepare) throw new Error(`Unsupported VGPlot action: ${name}`);
      return prepare(params as Params);
    },
    /** Restore against the same native identities and validation used by direct actions. */
    restore(binding: VgplotBinding, raw: unknown): VgplotOperation[] | null {
      const state = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Params) : undefined;
      const desired = state ? (Object.hasOwn(state, 'value') ? state.value : state.selectionValue) : raw;
      if (binding.kind === 'input') {
        const name =
          typeof state?.optionIndex === 'number'
            ? 'vgplot.set_input_option_index'
            : desired == null
              ? 'vgplot.clear_input'
              : 'vgplot.set_input_value';
        return [
          bound(
            binding,
            prepareInputAction(binding.input, { name, params: { index: state?.optionIndex, value: desired } }),
          ),
        ];
      }
      if (binding.kind === 'table') {
        const params = state ?? {};
        const sort = params.sortColumn;
        const plans = [
          prepareTableAction(binding.table, {
            name: sort == null ? 'vgplot.table_clear_sort' : 'vgplot.table_set_sort',
            params: { column: sort, desc: params.sortDesc },
          }),
        ];
        if (params.offset != null || params.limit != null)
          plans.push(
            prepareTableAction(binding.table, {
              name: 'vgplot.table_set_page',
              params: { offset: params.offset ?? undefined, limit: params.limit ?? undefined },
            }),
          );
        return plans.map((plan) => bound(binding, plan));
      }
      if (binding.kind === 'legend') {
        const handler = binding.legend.handler;
        return handler && interactorType(handler) === 'Toggle'
          ? [bound(binding, preparePointSelection(handler, desired))]
          : null;
      }
      if (binding.kind !== 'interactor') return null;
      const target = binding.interactor;
      const kind = binding.type;
      // Hover is transient. It cannot be recreated from recorded pointer-derived values.
      if (kind === 'Nearest') return null;
      const value = state?.selectionValue !== undefined ? state.selectionValue : desired;
      if (kind === 'Toggle' || kind === 'Region') return [bound(binding, preparePointSelection(target, value))];
      if (kind === 'Interval1D' || kind === 'Interval2D') {
        const dimension = kind === 'Interval1D' ? 1 : 2;
        const values =
          value == null
            ? null
            : dimension === 1
              ? Array.isArray(value)
                ? value
                : [state?.min, state?.max]
              : Array.isArray(value) && Array.isArray(value[0]) && Array.isArray(value[1])
                ? [...value[0], ...value[1]]
                : [];
        if (values && values.length !== dimension * 2) throw new Error(`Expected ${dimension * 2} interval values`);
        const plan = prepareInterval(target, dimension, values);
        return [bound(binding, plan.execute, plan.detail)];
      }
      if (kind === 'PanZoom') {
        const x = state?.x,
          y = state?.y;
        const params =
          Array.isArray(x) || Array.isArray(y)
            ? {
                x0: Array.isArray(x) ? x[0] : undefined,
                x1: Array.isArray(x) ? x[1] : undefined,
                y0: Array.isArray(y) ? y[0] : undefined,
                y1: Array.isArray(y) ? y[1] : undefined,
              }
            : null;
        const plan = preparePanZoom(target, params);
        return [bound(binding, plan.execute, undefined, plan.interaction)];
      }
      return null;
    },
  };
}
