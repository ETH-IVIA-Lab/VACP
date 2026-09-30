import type { VacpClock } from '@vacp/protocol';
import { compile, type TopLevelSpec } from 'vega-lite';

import { collectVegaLiteParams } from './params';
import type { VegaLiteSpecLike } from './types';

type Transform = { type: string; [key: string]: unknown };
type Dataset = {
  name: string;
  source?: string | string[];
  url?: string;
  values?: unknown;
  format?: { parse?: Record<string, unknown> };
  transform?: Transform[];
};
type Scale = { type?: string; domain?: unknown };
type Mark = { from?: { data?: string; facet?: { data?: string } }; marks?: Mark[]; scales?: Scale[] };

/** One source the chart reads: a url, inline values, or a named dataset the host fills. */
export type VegaLiteSource = {
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
  /** Fields Vega holds as instants, with the clock their axis reads. */
  temporal: ReadonlyMap<string, VacpClock>;
};

const silent = {
  level() {
    return silent;
  },
  error: () => silent,
  warn: () => silent,
  info: () => silent,
  debug: () => silent,
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function* marksOf(marks: readonly Mark[] | undefined): Generator<Mark> {
  for (const mark of marks ?? []) {
    yield mark;
    yield* marksOf(mark.marks);
  }
}

/** Fields a scale's domain reads, from any of Vega's domain forms. */
function domainFields(domain: unknown): string[] {
  if (!record(domain)) return [];
  if (typeof domain.field === 'string') return [domain.field];
  const fields = Array.isArray(domain.fields) ? domain.fields : [];
  return fields.flatMap((field) =>
    typeof field === 'string' ? [field] : record(field) && typeof field.field === 'string' ? [field.field] : [],
  );
}

function temporalFields(datasets: readonly Dataset[], scales: readonly Scale[]): Map<string, VacpClock> {
  const temporal = new Map<string, VacpClock>();
  for (const dataset of datasets) {
    for (const [field, type] of Object.entries(dataset.format?.parse ?? {}))
      if (typeof type === 'string' && /^(date|utc)\b/.test(type))
        temporal.set(field, type.startsWith('utc') ? 'utc' : 'local');
    for (const transform of dataset.transform ?? []) {
      if (transform.type === 'timeunit' && typeof transform.field === 'string') {
        const clock: VacpClock = transform.timezone === 'utc' ? 'utc' : 'local';
        const outputs = Array.isArray(transform.as) ? transform.as : [];
        for (const field of [transform.field, ...outputs]) if (typeof field === 'string') temporal.set(field, clock);
      }
      // Vega-Lite parses an inline source's temporal fields with a formula that writes epoch milliseconds.
      const parsed =
        transform.type === 'formula' && typeof transform.expr === 'string' ? /^toDate\(/.test(transform.expr) : false;
      if (parsed && typeof transform.as === 'string' && !temporal.has(transform.as))
        temporal.set(transform.as, 'local');
    }
  }
  for (const scale of scales)
    if (scale.type === 'time' || scale.type === 'utc')
      for (const field of domainFields(scale.domain)) temporal.set(field, scale.type === 'utc' ? 'utc' : 'local');
  return temporal;
}

/**
 * Compile the chart's spec and read its dataflow: each source's root dataset, the dataset its marks
 * read, and the fields Vega holds as instants. The adapter's data relations and temporal parsing
 * follow the compiled datasets, wherever Vega-Lite's optimizer placed the transforms.
 */
export function vegaLiteDataflow(spec: VegaLiteSpecLike): VegaLiteDataflow {
  const compiled = compile(spec as TopLevelSpec, { logger: silent as never }).spec as {
    data?: Dataset[];
    marks?: Mark[];
    scales?: Scale[];
  };
  const datasets = compiled.data ?? [];
  const byName = new Map(datasets.map((dataset) => [dataset.name, dataset]));
  const marks = [...marksOf(compiled.marks)];
  const shownBy = marks.flatMap((mark) => mark.from?.data ?? mark.from?.facet?.data ?? []);

  const lineage = (name: string): Dataset[] => {
    const chain: Dataset[] = [];
    for (let dataset = byName.get(name); dataset;) {
      chain.unshift(dataset);
      dataset = typeof dataset.source === 'string' ? byName.get(dataset.source) : undefined;
    }
    return chain;
  };
  const rowLevel = (chain: readonly Dataset[]) =>
    chain.every((dataset) => !(dataset.transform ?? []).some((transform) => transform.type === 'aggregate'));

  const stores = new Set(collectVegaLiteParams(spec).flatMap((param) => (param.select ? [`${param.name}_store`] : [])));
  const roots = datasets.filter((dataset) => dataset.source === undefined && !stores.has(dataset.name));
  const sources = roots.map((root): VegaLiteSource => {
    const chains = shownBy.flatMap((name) => {
      const chain = lineage(name);
      return chain[0]?.name === root.name ? [chain] : [];
    });
    const chain = chains.find(rowLevel) ?? chains[0] ?? [root];
    const shown = chain.at(-1)!.name;
    return {
      dataset: root.name,
      shown,
      transformed: shown !== root.name || !!root.transform?.length,
      data: {
        ...(root.url !== undefined ? { url: root.url } : {}),
        ...(Array.isArray(root.values) ? { values: root.values } : {}),
        ...(root.format !== undefined ? { format: root.format } : {}),
      },
    };
  });
  const scales = [...(compiled.scales ?? []), ...marks.flatMap((mark) => mark.scales ?? [])];
  return { sources, temporal: temporalFields(datasets, scales) };
}
