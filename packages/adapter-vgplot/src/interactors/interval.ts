import type { VgplotInteractorLike, VgplotScaleLike } from '../types';

type DomainValue = number | Date;

function parseDomainValue(value: unknown): DomainValue {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;

  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);

      if (Number.isFinite(n)) return n;
    }

    const t = Date.parse(trimmed);

    if (Number.isFinite(t)) return new Date(t);
  }

  throw new Error('Expected a number or a date-like string');
}

function dayOfYear0UTC(d: Date): number {
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const t = Date.UTC(year, d.getUTCMonth(), d.getUTCDate());

  return Math.floor((t - start) / 86_400_000);
}

export function readScaleDomain(scale: VgplotScaleLike | undefined): unknown[] | null {
  if (!scale) return null;
  const anyScale = scale;
  const raw = typeof anyScale.domain === 'function' ? anyScale.domain() : anyScale.domain;

  return Array.isArray(raw) ? raw : null;
}

function normalizeToScaleDomain(value: DomainValue, scale: VgplotScaleLike | undefined): DomainValue {
  const raw = readScaleDomain(scale);

  if (!raw || raw.length < 2) return value;
  const d0 = raw[0];
  const d1 = raw[raw.length - 1];

  // Date domain: accept epoch millis numbers and convert.
  if (d0 instanceof Date || d1 instanceof Date) {
    if (value instanceof Date) return value;

    if (typeof value === 'number' && Math.abs(value) > 1e10) return new Date(value);

    return value;
  }

  // Numeric domain: common case is day-of-year (0..365-ish). If caller passed a Date or an epoch timestamp,
  // convert to day-of-year so the brush renders correctly and filters match human interaction.
  if (typeof d0 === 'number' && typeof d1 === 'number') {
    const span = Math.abs(d1 - d0);
    const looksLikeDayOfYear = span > 0 && span <= 400 && Math.max(d0, d1) <= 400 && Math.min(d0, d1) >= -1;

    if (!looksLikeDayOfYear) return value;

    if (value instanceof Date) return dayOfYear0UTC(value);

    if (typeof value === 'number' && Math.abs(value) > 1e10) return dayOfYear0UTC(new Date(value));
  }

  return value;
}

/** Shared domain normalization for execution and presentation. */
export function intervalDomainValue(value: unknown, scale: VgplotScaleLike | undefined): DomainValue {
  return normalizeToScaleDomain(parseDomainValue(value), scale);
}

/** Resolve domain values and selection plumbing before any mutation. */
export function prepareInterval(interactor: VgplotInteractorLike, dimension: 1 | 2, raw: unknown[] | null) {
  if (interactor.constructor.name !== `Interval${dimension}D`)
    throw new Error(`Expected Interval${dimension}D interactor`);
  const selection = interactor.selection;
  const update = selection?.update;
  const clause = interactor.clause;
  if (!update || !clause) throw new Error('Interval is missing selection.update/clause');
  const values =
    raw?.map((value, index) =>
      intervalDomainValue(
        value,
        dimension === 1 ? interactor.scale : index < 2 ? interactor.xscale : interactor.yscale,
      ),
    ) ?? null;
  if (values) {
    for (let i = 0; i < values.length; i += 2) {
      // Native brushes sort domain endpoints regardless of gesture direction.
      if (Number(values[i]) > Number(values[i + 1])) [values[i], values[i + 1]] = [values[i + 1]!, values[i]!];
    }
  }
  const value = values && (dimension === 1 ? values : [values.slice(0, 2), values.slice(2, 4)]);
  const selectionClause = clause.call(interactor, value);
  const detail = values
    ? Object.fromEntries(
        (dimension === 1 ? ['min', 'max'] : ['x0', 'x1', 'y0', 'y1']).map((key, index) => [
          key,
          values[index] instanceof Date ? values[index].toISOString() : values[index],
        ]),
      )
    : undefined;
  return {
    detail,
    execute: () => {
      if (interactor.selection !== selection) throw new Error('Selection binding changed; prepare again');
      interactor.value = value ?? undefined;
      const { g, brush, scale, xscale, yscale } = interactor;
      if (g && brush) {
        if (!values) g.call(brush.moveSilent, null);
        else if (dimension === 1 && scale)
          g.call(
            brush.moveSilent,
            values.map((v) => scale.apply(v)).sort((a, b) => a - b),
          );
        else if (dimension === 2 && xscale && yscale) {
          const x = values.slice(0, 2).map((v) => xscale.apply(v));
          const y = values.slice(2, 4).map((v) => yscale.apply(v));
          g.call(brush.moveSilent, [
            [Math.min(...x), Math.min(...y)],
            [Math.max(...x), Math.max(...y)],
          ]);
        }
      }
      update.call(selection, selectionClause);
      return value ? { set: true } : { cleared: true };
    },
  };
}
