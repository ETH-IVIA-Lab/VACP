import { readInteractorSelection, type VgplotBindings } from './bindings';
import type { VacpActionDescriptor } from '@vacp/protocol';

import { isSelectionBackedNearest } from './interactors/nearest';
import { hasIndexedOptions, readInputValue, type CollectedInput } from './inputs';
import { makeViewRef } from './refs';
import type { VgplotProviderOptions, VgplotTableLike, VgplotInteractorLike, VgplotScaleLike } from './types';

type CollectedInteractor = {
  plotId: string;
  interactorId: string;
  interactor: VgplotInteractorLike;
};

type ObjectSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  default?: Record<string, unknown>;
};

function safeActionValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;

  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;

  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (Array.isArray(value)) {
    if (depth >= 4) return `[Array(${value.length})]`;

    return value.slice(0, 24).map((entry) => safeActionValue(entry, seen, depth + 1));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';

    if (depth >= 2) return `[${value.constructor?.name ?? 'Object'}]`;
    seen.add(value);

    try {
      const out: Record<string, unknown> = {};

      for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
        const next = safeActionValue(entry, seen, depth + 1);

        if (next !== undefined) out[key] = next;
      }

      return out;
    } finally {
      seen.delete(value);
    }
  }

  return String(value);
}

function primitiveValue(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;

  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;

  return undefined;
}

function valueArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const arr = value.map(primitiveValue).filter((entry) => entry !== undefined);

  return arr.length >= 2 ? arr : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);

    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function asEpochMs(value: unknown): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();

  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);

    return Number.isFinite(t) ? t : null;
  }

  return null;
}

function roundDomainNumber(value: number): number {
  if (value === 0) return 0;

  return Number(value.toPrecision(6));
}

function innerDomainPair(domain: unknown, numericOnly = false): [unknown, unknown] | null {
  const arr = valueArray(domain);

  if (!arr) return null;
  const a = arr[0];
  const b = arr[arr.length - 1];
  const n0 = asFiniteNumber(a);
  const n1 = asFiniteNumber(b);

  if (n0 !== null && n1 !== null) {
    const lo = Math.min(n0, n1);
    const hi = Math.max(n0, n1);
    const span = hi - lo || Math.max(Math.abs(hi), 1);

    return [roundDomainNumber(lo + span * 0.25), roundDomainNumber(lo + span * 0.75)];
  }

  if (numericOnly) return null;
  const t0 = asEpochMs(a);
  const t1 = asEpochMs(b);

  if (t0 !== null && t1 !== null) {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const span = hi - lo || 86_400_000;

    return [new Date(lo + span * 0.25).toISOString(), new Date(lo + span * 0.75).toISOString()];
  }

  return null;
}

function pairFromValue(value: unknown): [unknown, unknown] | null {
  const arr = valueArray(value);

  return arr ? [arr[0], arr[1]] : null;
}

function readScaleDomain(scale: VgplotScaleLike | undefined): unknown[] | undefined {
  if (!scale || typeof scale !== 'object') return undefined;

  const raw = typeof scale.domain === 'function' ? (scale as { domain: () => unknown }).domain() : scale.domain;

  const arr = valueArray(raw);

  return arr ?? undefined;
}

function firstInteractor(
  bindings: VgplotBindings,
  kind: string,
  predicate: (interactor: VgplotInteractorLike) => boolean = () => true,
): CollectedInteractor | null {
  for (const { plotId, plot } of bindings.plots) {
    for (const { index, interactor } of bindings.interactors(plot)) {
      if (!interactor || typeof interactor !== 'object') continue;

      if (interactor.constructor?.name !== kind) continue;

      if (!predicate(interactor)) continue;

      return { plotId, interactorId: String(index), interactor };
    }
  }

  return null;
}

function interactorParams(entry: CollectedInteractor | null): Record<string, unknown> | null {
  return entry ? { plotId: entry.plotId, interactorId: entry.interactorId } : null;
}

function inputDefaultValue(input: CollectedInput) {
  const selected = readInputValue(input).value;

  if (/slider/i.test(input.meta.kind)) {
    const value = primitiveValue(selected);

    if (value !== undefined) return value;
    const selection = valueArray((input.input.selection as { value?: unknown } | undefined)?.value);

    if (selection) return selection[selection.length - 1];
  }

  return safeActionValue(selected ?? (input.input.selection as { value?: unknown } | undefined)?.value ?? null);
}

function firstTableColumn(table: VgplotTableLike): string | null {
  if (table.schema?.length) return table.schema[0]!.column;
  const columns = table.columns;

  if (Array.isArray(columns)) {
    for (const column of columns) {
      if (typeof column === 'string' && column && column !== '*') return column;

      if (column && typeof column === 'object' && typeof (column as { name?: unknown }).name === 'string') {
        return (column as { name: string }).name;
      }
    }
    return null;
  }

  if (columns instanceof Map) {
    const first = columns.keys().next().value;

    return typeof first === 'string' && first ? first : null;
  }

  if (columns && typeof columns === 'object') {
    const first = Object.keys(columns)[0];

    return first || null;
  }

  return null;
}

function objectSchema(
  properties: Record<string, unknown>,
  required?: string[],
  defaults?: Record<string, unknown> | null,
): ObjectSchema {
  return {
    type: 'object',
    properties,
    ...(required?.length ? { required } : null),
    ...(defaults ? { default: defaults } : null),
  };
}

export function actionDescriptorsForDashboard(args: {
  bindings: VgplotBindings;
  options: VgplotProviderOptions;
}): VacpActionDescriptor[] {
  const hasInterval1D = args.bindings.plots.some((p) =>
    args.bindings.interactors(p.plot).some(({ interactor: i }) => i.constructor?.name === 'Interval1D'),
  );
  const hasInterval2D = args.bindings.plots.some((p) =>
    args.bindings.interactors(p.plot).some(({ interactor: i }) => i.constructor?.name === 'Interval2D'),
  );
  const hasToggle = args.bindings.plots.some((p) =>
    args.bindings.interactors(p.plot).some(({ interactor: i }) => i.constructor?.name === 'Toggle'),
  );
  const hasNearest = args.bindings.plots.some((p) =>
    args.bindings.interactors(p.plot).some(({ interactor }) => isSelectionBackedNearest(interactor)),
  );
  const hasRegion = args.bindings.plots.some((p) =>
    args.bindings.interactors(p.plot).some(({ interactor: i }) => i.constructor?.name === 'Region'),
  );
  const hasPanZoom = args.bindings.plots.some((p) =>
    args.bindings.interactors(p.plot).some(({ interactor: i }) => i.constructor?.name === 'PanZoom'),
  );

  const legendEntry = args.bindings.plots
    .flatMap(({ plotId, plot }) => args.bindings.legends(plot).map(({ legend }) => ({ plotId, legend })))
    .find(({ legend }) => legend.selection && legend.handler?.constructor.name === 'Toggle');
  const hasLegendToggle = !!legendEntry;
  const hasTables = (args.bindings.tables ?? []).length > 0;
  const hasInputs = args.bindings.inputs.length > 0;
  const hasOptionInputs = args.bindings.inputs.some(hasIndexedOptions);

  const viewRef = makeViewRef({ appId: args.options.appId, viewId: args.options.viewId, suffix: '' });
  const actions: VacpActionDescriptor[] = [];
  const interval1d = firstInteractor(args.bindings, 'Interval1D');
  const interval2d = firstInteractor(args.bindings, 'Interval2D');
  const toggle = firstInteractor(args.bindings, 'Toggle');
  const nearest = firstInteractor(args.bindings, 'Nearest', isSelectionBackedNearest);
  const region = firstInteractor(args.bindings, 'Region');
  const panZoom = firstInteractor(args.bindings, 'PanZoom');
  const optionInput = args.bindings.inputs.find(hasIndexedOptions) ?? null;
  const input = args.bindings.inputs[0] ?? null;
  const tableEntry = args.bindings.tables?.[0] ?? null;

  if (hasInterval1D) {
    const current = pairFromValue(readInteractorSelection(interval1d?.interactor));
    const domain = current ?? innerDomainPair(readScaleDomain(interval1d?.interactor.scale));
    actions.push({
      name: 'vgplot.set_interval_1d',
      title: 'Filter range',
      description:
        'Set this brush range in domain units. Existing crossfilters remain active. Preserve unrelated selections unless the user requests changing them.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        {
          plotId: { type: 'string' },
          interactorId: { type: 'string' },
          min: { type: ['number', 'string'] },
          max: { type: ['number', 'string'] },
        },
        ['interactorId', 'min', 'max'],
        interval1d && domain
          ? { ...interactorParams(interval1d), min: domain[0], max: domain[1] }
          : interactorParams(interval1d),
      ),
    });
    actions.push({
      name: 'vgplot.clear_interval_1d',
      title: 'Clear range',
      description:
        'Remove this brush range. Use when the user requests clearing this filter. Changing another filter does not require clearing this one.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        ['interactorId'],
        interactorParams(interval1d),
      ),
    });
  }

  if (hasInterval2D) {
    const current = readInteractorSelection(interval2d?.interactor);

    const currentX = Array.isArray(current) ? pairFromValue(current[0]) : null;
    const currentY = Array.isArray(current) ? pairFromValue(current[1]) : null;
    const x = currentX ?? innerDomainPair(readScaleDomain(interval2d?.interactor.xscale));
    const y = currentY ?? innerDomainPair(readScaleDomain(interval2d?.interactor.yscale));
    actions.push({
      name: 'vgplot.set_interval_2d',
      title: 'Filter region',
      description:
        'Set this brush region in x/y domain units. Existing crossfilters remain active. Preserve unrelated selections unless the user requests changing them.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        {
          plotId: { type: 'string' },
          interactorId: { type: 'string' },
          x0: { type: ['number', 'string'] },
          x1: { type: ['number', 'string'] },
          y0: { type: ['number', 'string'] },
          y1: { type: ['number', 'string'] },
        },
        ['interactorId', 'x0', 'x1', 'y0', 'y1'],
        interval2d && x && y
          ? { ...interactorParams(interval2d), x0: x[0], x1: x[1], y0: y[0], y1: y[1] }
          : interactorParams(interval2d),
      ),
    });
    actions.push({
      name: 'vgplot.clear_interval_2d',
      title: 'Clear region',
      description:
        'Remove this brush region. Use when the user requests clearing this filter. Changing another filter does not require clearing this one.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        ['interactorId'],
        interactorParams(interval2d),
      ),
    });
  }

  if (hasToggle) {
    actions.push({
      name: 'vgplot.set_toggle',
      title: 'Select values',
      description: 'Set a Toggle interactor value.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' }, value: {} },
        ['interactorId', 'value'],
        toggle
          ? { ...interactorParams(toggle), value: safeActionValue(readInteractorSelection(toggle.interactor)) }
          : null,
      ),
    });
    actions.push({
      name: 'vgplot.clear_toggle',
      title: 'Clear selection',
      description: 'Clear a Toggle interactor value.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        ['interactorId'],
        interactorParams(toggle),
      ),
    });
  }

  if (hasNearest) {
    actions.push({
      name: 'vgplot.clear_nearest',
      title: 'Clear hover',
      description:
        'Clear a selection-backed Nearest hover or inspect interactor. Param-backed Nearest values are pointer-derived and are not exposed as semantic actions.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        ['interactorId'],
        interactorParams(nearest),
      ),
    });
  }

  if (hasRegion) {
    actions.push({
      name: 'vgplot.set_region',
      title: 'Select regions',
      description: 'Set a Region categorical selection value.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' }, value: {} },
        ['interactorId', 'value'],
        region
          ? { ...interactorParams(region), value: safeActionValue(readInteractorSelection(region.interactor)) }
          : null,
      ),
    });
    actions.push({
      name: 'vgplot.clear_region',
      title: 'Clear regions',
      description: 'Clear a Region selection.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        ['interactorId'],
        interactorParams(region),
      ),
    });
  }

  if (hasPanZoom) {
    const x = innerDomainPair(panZoom?.interactor.x ?? readScaleDomain(panZoom?.interactor.xscale), true);
    const y = innerDomainPair(panZoom?.interactor.y ?? readScaleDomain(panZoom?.interactor.yscale), true);
    actions.push({
      name: 'vgplot.set_pan_zoom',
      title: 'Change view',
      description: 'Set a PanZoom view domain.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        {
          plotId: { type: 'string' },
          interactorId: { type: 'string' },
          x0: { type: 'number' },
          x1: { type: 'number' },
          y0: { type: 'number' },
          y1: { type: 'number' },
        },
        ['interactorId'],
        panZoom
          ? {
              ...interactorParams(panZoom),
              ...(x ? { x0: x[0], x1: x[1] } : null),
              ...(y ? { y0: y[0], y1: y[1] } : null),
            }
          : null,
      ),
    });
    actions.push({
      name: 'vgplot.clear_pan_zoom',
      title: 'Reset view',
      description: 'Clear a PanZoom view domain.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { plotId: { type: 'string' }, interactorId: { type: 'string' } },
        ['interactorId'],
        interactorParams(panZoom),
      ),
    });
  }

  if (hasLegendToggle) {
    actions.push({
      name: 'vgplot.set_legend_toggle',
      title: 'Select legend values',
      description: 'Set an interactive legend (categorical) selection.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, channel: { type: 'string' }, value: {} },
        default: { plotId: legendEntry?.plotId, channel: legendEntry?.legend.channel, value: null },
        required: ['value'],
      },
    });
    actions.push({
      name: 'vgplot.clear_legend_toggle',
      title: 'Clear legend selection',
      description: 'Clear an interactive legend selection.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: {
        type: 'object',
        properties: { plotId: { type: 'string' }, channel: { type: 'string' } },
        default: { plotId: legendEntry?.plotId, channel: legendEntry?.legend.channel },
      },
    });
  }

  if (hasOptionInputs) {
    actions.push({
      name: 'vgplot.set_input_option_index',
      title: 'Select option',
      description: 'Set a VGPlot input widget by option index.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { ref: { type: 'string' }, index: { type: 'number' } },
        ['ref', 'index'],
        optionInput ? { ref: optionInput.ref, index: 0 } : null,
      ),
    });
  }

  if (hasInputs) {
    actions.push({
      name: 'vgplot.set_input_value',
      title: 'Set control',
      description: 'Set a VGPlot input widget value.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { ref: { type: 'string' }, value: {} },
        ['ref', 'value'],
        input ? { ref: input.ref, value: inputDefaultValue(input) } : null,
      ),
    });
    actions.push({
      name: 'vgplot.clear_input',
      title: 'Reset control',
      description: 'Clear or reset a VGPlot input widget.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema({ ref: { type: 'string' } }, ['ref'], input ? { ref: input.ref } : null),
    });
  }

  if (hasTables) {
    const sortColumn = tableEntry ? tableEntry.table.sortColumn || firstTableColumn(tableEntry.table) : null;
    actions.push({
      name: 'vgplot.table_set_sort',
      title: 'Sort table',
      description: 'Sort a VGPlot table by a column.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { tableId: { type: 'string' }, column: { type: 'string' }, desc: { type: 'boolean' } },
        ['column'],
        tableEntry && sortColumn
          ? {
              tableId: tableEntry.tableId,
              column: sortColumn,
              desc: Boolean(tableEntry.table.sortDesc),
            }
          : null,
      ),
    });
    actions.push({
      name: 'vgplot.table_clear_sort',
      title: 'Reset sorting',
      description: 'Clear the sort order for a VGPlot table.',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { tableId: { type: 'string' } },
        undefined,
        tableEntry ? { tableId: tableEntry.tableId } : null,
      ),
    });
    actions.push({
      name: 'vgplot.table_set_page',
      title: 'Change table page',
      description: 'Set VGPlot table pagination (offset/limit).',
      operation: { kind: 'mutation', affects: [viewRef] },
      parameters: objectSchema(
        { tableId: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
        undefined,
        tableEntry
          ? {
              tableId: tableEntry.tableId,
              offset: typeof tableEntry.table.offset === 'number' ? tableEntry.table.offset : 0,
              limit:
                typeof tableEntry.table.limit === 'number' && tableEntry.table.limit > 0 ? tableEntry.table.limit : 50,
            }
          : null,
      ),
    });
  }

  return actions;
}
