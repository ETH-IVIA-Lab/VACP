import * as d3 from 'd3';

import type { CarDatum } from './chart';

export type CarsDataset = {
  data: CarDatum[];
  dimensions: string[];
};

function normalizeDsv(raw: string): string {
  return raw.replaceAll('\r\n', '\n').replaceAll('\r', '');
}

export async function loadCarsDataset(url: string): Promise<CarsDataset> {
  const raw = await d3.text(url);

  if (raw === null) throw new Error(`Failed to load: ${url}`);

  const parsed = d3.dsvFormat(';').parse(normalizeDsv(raw));

  if (!parsed.length) return { data: [], dimensions: [] };

  const sample = parsed[0];
  const columns = parsed.columns?.length ? parsed.columns : Object.keys(sample);

  const dimensions = columns.filter((key) => {
    if (key === 'Car' || key === 'Origin') return false;
    const v = sample[key];

    return Number.isFinite(parseFloat(String(v)));
  });

  const data: CarDatum[] = parsed.map((row, i) => {
    const rec = row;

    const out: Record<string, number | string> = {
      id: i,
      Car: (rec.Car ?? '').trim(),
      Origin: (rec.Origin ?? '').trim(),
    };

    for (const dim of dimensions) {
      const v = parseFloat(rec[dim]);
      out[dim] = Number.isFinite(v) ? v : 0;
    }

    return out as CarDatum;
  });

  return { data, dimensions };
}
