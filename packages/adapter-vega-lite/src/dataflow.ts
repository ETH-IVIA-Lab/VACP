import type { VacpClock } from '@vacp/protocol';
import { splitAccessPath } from 'vega';
import type { Spec } from 'vega';

import { collectVegaLiteParams } from './params';
import type { VegaLiteSpecLike } from './types';

type Dataset = import('vega').Data;
type Scale = import('vega').Scale;
type Mark = import('vega').Mark;

/** The fields of one source's rows that Vega holds as instants or reads as numbers. */
export type VegaLiteFieldTypes = {
  /** Fields Vega holds as instants, with the clock their axis reads. */
  temporal: ReadonlyMap<string, VacpClock>;
  /** Fields a continuous scale reads, which Vega coerces to numbers however the source typed them. */
  numeric: ReadonlySet<string>;
};

/** One source the chart reads: a url, inline values, or a named dataset the host fills. */
export type VegaLiteSource = VegaLiteFieldTypes & {
  /** The root dataset Vega loads the source into. Its input holds the rows as they loaded. */
  dataset: string;
  /** The dataset the chart's marks read from this source, after its filters and calculations. */
  shown: string;
  /** Whether the chart's transforms can change which rows or values the source loaded. */
  transformed: boolean;
  data: { url?: string; values?: unknown[]; format?: unknown };
};

/** What the compiled Vega spec says about the chart's data, read once per chart. */
export type VegaLiteDataflow = {
  sources: VegaLiteSource[];
  /** Fields any source holds as instants, which selections and hover read on the axis's clock. */
  temporal: ReadonlyMap<string, VacpClock>;
};

const clocks: Readonly<Record<string, VacpClock>> = { time: 'local', utc: 'utc' };
const continuous = new Set(['linear', 'log', 'pow', 'sqrt', 'symlog']);
/** Aggregate operations that read numbers and write numbers. */
const arithmetic = new Set([
  'mean',
  'average',
  'sum',
  'product',
  'median',
  'q1',
  'q3',
  'variance',
  'variancep',
  'stdev',
  'stdevp',
  'stderr',
  'ci0',
  'ci1',
]);

/** The clock of a Vega scale type: local for `time`, UTC for `utc`, and none for other scales. */
export const scaleClock = (type: string | undefined): VacpClock | undefined => (type ? clocks[type] : undefined);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The row key a Vega field accessor reads, or none for a nested path. Vega escapes dots in flat names. */
function rowKey(field: unknown): string | undefined {
  if (typeof field !== 'string') return undefined;
  const path = splitAccessPath(field);
  return path.length === 1 ? path[0] : undefined;
}

/** Every mark with the dataset it reads, resolving a facet's name to the dataset it partitions. */
function* marksOf(
  marks: readonly Mark[] | undefined,
  facets: ReadonlyMap<string, string> = new Map(),
): Generator<{ mark: Mark; data?: string }> {
  for (const mark of marks ?? []) {
    const from = mark.from && 'facet' in mark.from ? mark.from.facet.data : mark.from?.data;
    const data = from === undefined ? undefined : (facets.get(from) ?? from);
    yield { mark, data };
    const facet = mark.from && 'facet' in mark.from ? mark.from.facet.name : undefined;
    yield* marksOf(
      mark.type === 'group' ? mark.marks : undefined,
      facet && data ? new Map(facets).set(facet, data) : facets,
    );
  }
}

/** Fields a scale's domain reads, with their datasets, from any of Vega's domain forms. */
function domainFields(domain: unknown): Array<{ data?: string; field: string }> {
  if (!record(domain)) return [];
  const data = typeof domain.data === 'string' ? domain.data : undefined;
  if (typeof domain.field === 'string') return [{ data, field: domain.field }];
  const fields = Array.isArray(domain.fields) ? domain.fields : [];
  return fields.flatMap((field) =>
    typeof field === 'string'
      ? [{ data, field }]
      : record(field) && typeof field.field === 'string'
        ? [{ data: typeof field.data === 'string' ? field.data : data, field: field.field }]
        : [],
  );
}

/** Every `{ scale, field }` pair a mark's encoding reads, through production rules too. */
function* encodedFields(value: unknown): Generator<{ scale: string; field: string }> {
  if (Array.isArray(value)) for (const entry of value) yield* encodedFields(entry);
  else if (record(value)) {
    if (typeof value.scale === 'string' && typeof value.field === 'string')
      yield { scale: value.scale, field: value.field };
    for (const entry of Object.values(value)) if (typeof entry === 'object') yield* encodedFields(entry);
  }
}

/** A field a scale reads from a dataset, with the scale's type. */
type ScaleRead = { data?: string; field: string; type?: string };

function scaleReads(scales: readonly Scale[], marks: ReadonlyArray<{ mark: Mark; data?: string }>): ScaleRead[] {
  const types = new Map(
    scales.flatMap((scale) => (scale.name && scale.type ? [[scale.name, scale.type] as const] : [])),
  );
  return [
    ...scales.flatMap((scale) => domainFields(scale.domain).map((read) => ({ ...read, type: scale.type }))),
    ...marks.flatMap(({ mark, data }) =>
      [...encodedFields(mark.encode)].map(({ scale, field }) => ({ data, field, type: types.get(scale) })),
    ),
  ];
}

/** The field types `datasets` and the scales reading them give their rows. */
function fieldTypes(datasets: readonly Dataset[], reads: readonly ScaleRead[]): VegaLiteFieldTypes {
  const temporal = new Map<string, VacpClock>();
  const numeric = new Set<string>();
  for (const dataset of datasets) {
    for (const [field, type] of Object.entries(
      'format' in dataset && dataset.format && 'parse' in dataset.format && typeof dataset.format.parse === 'object'
        ? dataset.format.parse
        : {},
    ))
      if (typeof type === 'string' && /^(date|utc)\b/.test(type))
        temporal.set(field, type.startsWith('utc') ? 'utc' : 'local');
    for (const transform of dataset.transform ?? []) {
      if (transform.type === 'timeunit') {
        const clock: VacpClock = transform.timezone === 'utc' ? 'utc' : 'local';
        const outputs = 'as' in transform && Array.isArray(transform.as) ? transform.as : [];
        for (const field of [rowKey(transform.field), ...outputs])
          if (typeof field === 'string') temporal.set(field, clock);
      }
      // Vega-Lite parses an inline source's temporal fields with a formula that writes epoch milliseconds.
      const parsed =
        transform.type === 'formula' && typeof transform.expr === 'string' ? /^toDate\(/.test(transform.expr) : false;
      if (parsed && transform.type === 'formula' && typeof transform.as === 'string' && !temporal.has(transform.as))
        temporal.set(transform.as, 'local');
    }
  }
  for (const read of reads) {
    const field = rowKey(read.field);
    const clock = scaleClock(read.type);
    if (!field) continue;
    if (clock) temporal.set(field, clock);
    else if (read.type && continuous.has(read.type)) numeric.add(field);
  }
  // An aggregate or bin a continuous scale reads makes its input a number too, through every level.
  for (let grew = true; grew;) {
    grew = false;
    const add = (field: string | undefined) => {
      if (field && !numeric.has(field) && !temporal.has(field)) {
        numeric.add(field);
        grew = true;
      }
    };
    for (const dataset of datasets)
      for (const transform of dataset.transform ?? []) {
        const outputs = 'as' in transform && Array.isArray(transform.as) ? transform.as : [];
        if (transform.type === 'bin' && outputs.some((field) => typeof field === 'string' && numeric.has(field)))
          add(rowKey(transform.field));
        if (transform.type !== 'aggregate' && transform.type !== 'joinaggregate') continue;
        const fields = Array.isArray(transform.fields) ? transform.fields : [];
        const ops = Array.isArray(transform.ops) ? transform.ops : [];
        fields.forEach((field, index) => {
          const op = ops[index];
          const output =
            outputs[index] ?? (typeof op === 'string' && typeof field === 'string' ? `${op}_${field}` : undefined);
          if (
            ((typeof op === 'string' && arithmetic.has(op)) || op === 'min' || op === 'max') &&
            typeof output === 'string' &&
            numeric.has(output)
          )
            add(rowKey(field));
        });
      }
  }
  for (const field of temporal.keys()) numeric.delete(field);
  return { temporal, numeric };
}

/**
 * Read the host's compiled dataflow: each source's root dataset, the dataset its marks
 * read, and the fields each source's rows hold as instants or numbers. The adapter's data relations
 * and temporal parsing follow the compiled datasets, wherever Vega-Lite's optimizer placed the transforms.
 */
export function vegaLiteDataflow(spec: VegaLiteSpecLike, vgSpec: Spec): VegaLiteDataflow {
  const compiled = vgSpec;
  const datasets = compiled.data ?? [];
  const byName = new Map(datasets.map((dataset) => [dataset.name, dataset]));
  const marks = [...marksOf(compiled.marks)];
  const shownBy = marks.flatMap(({ data }) => data ?? []);
  const reads = scaleReads(
    [...(compiled.scales ?? []), ...marks.flatMap(({ mark }) => (mark.type === 'group' ? (mark.scales ?? []) : []))],
    marks,
  );

  const lineage = (name: string): Dataset[] => {
    const chain: Dataset[] = [];
    for (let dataset = byName.get(name); dataset;) {
      chain.unshift(dataset);
      dataset = 'source' in dataset && typeof dataset.source === 'string' ? byName.get(dataset.source) : undefined;
    }
    return chain;
  };
  const rowLevel = (chain: readonly Dataset[]) =>
    chain.every((dataset) => !(dataset.transform ?? []).some((transform) => transform.type === 'aggregate'));

  const stores = new Set(collectVegaLiteParams(spec).flatMap((param) => (param.select ? [`${param.name}_store`] : [])));
  const roots = datasets.filter((dataset) => !('source' in dataset) && !stores.has(dataset.name));
  const sources = roots.map((root): VegaLiteSource => {
    const chains = shownBy.flatMap((name) => {
      const chain = lineage(name);
      return chain[0]?.name === root.name ? [chain] : [];
    });
    const chain = chains.find(rowLevel) ?? chains[0] ?? [root];
    const shown = chain.at(-1)!.name;
    // A source's rows take their field types from the datasets derived from it and the scales reading those.
    const family = datasets.filter((dataset) => lineage(dataset.name)[0]?.name === root.name);
    const names = new Set(family.map((dataset) => dataset.name));
    return {
      dataset: root.name,
      shown,
      transformed: shown !== root.name || !!root.transform?.length,
      data: {
        ...('url' in root && typeof root.url === 'string' ? { url: root.url } : {}),
        ...('values' in root && Array.isArray(root.values) ? { values: root.values } : {}),
        ...('format' in root && root.format !== undefined ? { format: root.format } : {}),
      },
      ...fieldTypes(
        family,
        reads.filter((read) => read.data !== undefined && names.has(read.data)),
      ),
    };
  });
  return { sources, temporal: fieldTypes(datasets, reads).temporal };
}
