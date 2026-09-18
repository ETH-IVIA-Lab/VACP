import irisRows from './data/iris.json';
import mtcarsRows from './data/mtcars.json';

export type DatasetRow = Record<string, unknown> & { id: string };

type ColumnKind = 'number' | 'string' | 'boolean' | 'unknown';

type DatasetColumn = {
  key: string;
  kind: ColumnKind;
};

export type Encoding = {
  x: string | null;
  y: string | null;
  color: string | null;
};

export type Dataset = {
  id: DatasetId;
  title: string;
  description: string;
  rows: DatasetRow[];
  columns: DatasetColumn[];
  defaultEncoding: Encoding;
};

type DatasetSpec = {
  title: string;
  description: string;
  idField: string;
  defaultEncoding: Encoding;
  rawRows: Array<Record<string, unknown>>;
};

const DATASETS = {
  iris: {
    title: 'Iris',
    description: '150 iris flowers with sepal/petal measurements (cm) and species label.',
    idField: 'Id',
    defaultEncoding: { x: 'SepalLengthCm', y: 'PetalLengthCm', color: 'Species' },
    rawRows: irisRows,
  },
  mtcars: {
    title: 'Motor Trend Cars (mtcars)',
    description: '32 cars (1974 Motor Trend US magazine): fuel economy and engine attributes.',
    idField: 'model',
    defaultEncoding: { x: 'hp', y: 'mpg', color: 'cyl' },
    rawRows: mtcarsRows,
  },
} satisfies Record<string, DatasetSpec>;

export type DatasetId = keyof typeof DATASETS;

export function isDatasetId(value: string): value is DatasetId {
  return Object.prototype.hasOwnProperty.call(DATASETS, value);
}

export function listDatasets(): Array<Pick<Dataset, 'id' | 'title' | 'description'>> {
  return (Object.entries(DATASETS) as Array<[DatasetId, DatasetSpec]>).map(([id, d]) => ({
    id,
    title: d.title,
    description: d.description,
  }));
}

function inferKind(values: unknown[]): ColumnKind {
  const nonNull = values.filter((v) => v !== null && v !== undefined);

  if (nonNull.length === 0) return 'unknown';

  if (nonNull.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'number';

  if (nonNull.every((v) => typeof v === 'string')) return 'string';

  if (nonNull.every((v) => typeof v === 'boolean')) return 'boolean';

  return 'unknown';
}

function inferColumns(rows: DatasetRow[]): DatasetColumn[] {
  const keys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));

  return Array.from(keys)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, kind: inferKind(rows.map((r) => r[key])) }));
}

export async function loadDataset(id: DatasetId): Promise<Dataset> {
  const spec = DATASETS[id];

  if (!spec) throw new Error(`Unknown dataset: ${id}`);

  const rows = spec.rawRows.map((r) => {
    const row: Record<string, unknown> = { ...r };
    const rawId = row[spec.idField];
    const safeId = String(rawId);

    // Avoid confusing duplicate "id" columns when the raw dataset uses an `Id`-style primary key.
    if (spec.idField !== 'id' && spec.idField.toLowerCase() === 'id') {
      delete row[spec.idField];
    }

    return { ...row, id: safeId } satisfies DatasetRow;
  });

  return {
    id,
    title: spec.title,
    description: spec.description,
    rows,
    columns: inferColumns(rows),
    defaultEncoding: spec.defaultEncoding,
  };
}
