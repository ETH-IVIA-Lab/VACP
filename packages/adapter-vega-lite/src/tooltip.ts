import { matchingSceneItems, sceneMarks, sceneOffset, scenePointToViewport } from './scene';
import type { VacpActionDescriptor, VacpClock, VacpRef } from '@vacp/protocol';
import type { VacpActionRegistry } from '@vacp/runtime';
import { inputInstant } from './temporal';
import type { VegaLiteSpecLike, VegaViewLike } from './types';

const VEGA_LITE_TOOLTIP_HOVER_ACTION = 'vega_lite.hover_tooltip';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type TooltipFieldInfo = {
  fields: Set<string>;
  titleToField: Map<string, string>;
};

function specHasTooltip(spec: VegaLiteSpecLike): boolean {
  const encoding = spec.encoding;

  if (isRecord(encoding) && encoding.tooltip != null) return true;

  const mark = spec.mark;

  if (isRecord(mark) && mark.tooltip != null) return true;

  const children: unknown[] = [];

  if (Array.isArray(spec.layer)) children.push(...spec.layer);

  if (Array.isArray(spec.hconcat)) children.push(...spec.hconcat);

  if (Array.isArray(spec.vconcat)) children.push(...spec.vconcat);

  if (Array.isArray(spec.concat)) children.push(...spec.concat);

  if (spec.spec) children.push(spec.spec);

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;

    if (specHasTooltip(child)) return true;
  }

  return false;
}

function collectTooltipFieldInfo(spec: VegaLiteSpecLike): TooltipFieldInfo {
  const fields = new Set<string>();
  const titleToField = new Map<string, string>();

  const visitTooltip = (tooltip: unknown) => {
    if (tooltip === null || tooltip === undefined) return;

    if (typeof tooltip === 'string') {
      fields.add(tooltip);

      return;
    }

    if (Array.isArray(tooltip)) {
      tooltip.forEach(visitTooltip);

      return;
    }

    if (!isRecord(tooltip)) return;

    const field = typeof tooltip.field === 'string' ? tooltip.field : null;
    const title = typeof tooltip.title === 'string' ? tooltip.title : null;

    if (field) fields.add(field);

    if (field && title && !titleToField.has(title)) titleToField.set(title, field);
  };

  const walk = (s: VegaLiteSpecLike) => {
    const enc = s.encoding;

    if (isRecord(enc) && enc.tooltip != null) visitTooltip(enc.tooltip);

    const children: unknown[] = [];

    if (Array.isArray(s.layer)) children.push(...s.layer);

    if (Array.isArray(s.hconcat)) children.push(...s.hconcat);

    if (Array.isArray(s.vconcat)) children.push(...s.vconcat);

    if (Array.isArray(s.concat)) children.push(...s.concat);

    if (s.spec) children.push(s.spec);

    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      walk(child);
    }
  };

  walk(spec);

  return { fields, titleToField };
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeHoverValue(value: unknown) {
  if (value === undefined) return null;

  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) {
    const t = value.getTime();

    return Number.isFinite(t) ? t : null;
  }

  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === 'object') {
    if (Object.keys(value as Record<string, unknown>).length === 0) return null;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function computeHoverFields(args: {
  tooltipInfo: TooltipFieldInfo;
  allowed: Set<string> | null;
  item: unknown;
  value: unknown;
}): Record<string, unknown> {
  const datum = isRecord((args.item as any)?.datum) ? ((args.item as any).datum as Record<string, unknown>) : null;
  const tooltipValue = isRecord(args.value) ? args.value : null;
  const out: Record<string, unknown> = {};

  args.tooltipInfo.fields.forEach((field) => {
    const raw =
      (datum && Object.prototype.hasOwnProperty.call(datum, field) ? datum[field] : undefined) ??
      (tooltipValue && Object.prototype.hasOwnProperty.call(tooltipValue, field) ? tooltipValue[field] : undefined);

    const sanitized = sanitizeHoverValue(raw);

    if (sanitized === null || sanitized === undefined) return;

    if (args.allowed && !args.allowed.has(field)) return;
    out[field] = sanitized;
  });

  if (tooltipValue) {
    for (const [title, field] of args.tooltipInfo.titleToField.entries()) {
      if (args.allowed && !args.allowed.has(field)) continue;

      if (Object.prototype.hasOwnProperty.call(out, field)) continue;

      if (!Object.prototype.hasOwnProperty.call(tooltipValue, title)) continue;
      const sanitized = sanitizeHoverValue(tooltipValue[title]);

      if (sanitized === null || sanitized === undefined) continue;
      out[field] = sanitized;
    }
  }

  // Last resort: if we still have no predicates but we know the DuckDB columns,
  // pick any overlapping datum fields so `vacp_handle` can still resemble focus.
  if (!Object.keys(out).length && datum && args.allowed) {
    for (const field of args.allowed) {
      if (!Object.prototype.hasOwnProperty.call(datum, field)) continue;
      const sanitized = sanitizeHoverValue(datum[field]);

      if (sanitized === null || sanitized === undefined) continue;
      out[field] = sanitized;
    }
  }

  return out;
}

export function createVegaLiteTooltipBinding({
  view,
  spec,
  root,
  actionRegistry,
  actionDescriptors,
  vizRef,
  temporal,
}: {
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  root?: HTMLElement;
  actionRegistry: VacpActionRegistry;
  actionDescriptors: VacpActionDescriptor[];
  vizRef: VacpRef;
  /** Fields Vega holds as instants. A requested value for one becomes its instant. */
  temporal: ReadonlyMap<string, VacpClock>;
}) {
  let hover: { fields: Record<string, unknown>; markName: string; value: unknown } | null = null;
  let suppressed = false;
  const hasTooltip = specHasTooltip(spec);

  const tooltipInfo = collectTooltipFieldInfo(spec);
  if (hasTooltip) {
    const hoverDescriptor: VacpActionDescriptor = {
      name: VEGA_LITE_TOOLTIP_HOVER_ACTION,
      title: 'Inspect mark',
      description:
        'Point at one mark and show its tooltip, as hovering does, e.g. { fields: { name: "Ann" } }. The result reports the tooltip shown and how many marks match: add fields until one mark matches. When nothing matches, it lists the named marks and their fields. Until the hover clears, `vacp_handle` holds the rows matching `fields`.',
      operation: { kind: 'mutation', contract: VEGA_LITE_TOOLTIP_HOVER_ACTION, affects: [vizRef] },
      parameters: {
        type: 'object',
        properties: {
          clear: { type: 'boolean', description: 'If true, clear the current hover focus.' },
          fields: {
            type: 'object',
            description: 'Field-to-value map to treat as the hovered/selected datum.',
          },
          value: { description: 'Tooltip payload from Vega, when fields are not available.' },
          markName: {
            type: 'string',
            description: 'Vega mark name, such as "layer_1_marks", to match only that mark.',
          },
        },
      },
    };

    const parseHover = (params: unknown) => {
      const p = isRecord(params) ? params : {};
      const clear = p.clear === true;
      const fieldsParam = p.fields;
      const valueParam = p.value;
      const markName = typeof p.markName === 'string' ? p.markName : '';
      const requested: Record<string, unknown> = (() => {
        if (isRecord(fieldsParam)) {
          const out: Record<string, unknown> = {};

          for (const [k, v] of Object.entries(fieldsParam)) {
            if (!k) continue;
            const sanitized = sanitizeHoverValue(v);

            if (sanitized === null || sanitized === undefined) continue;
            out[k] = sanitized;
          }

          return out;
        }

        if (isRecord(valueParam)) {
          const v = valueParam;
          const out: Record<string, unknown> = {};

          for (const [k, raw] of Object.entries(v)) {
            const field = tooltipInfo.titleToField.get(k) ?? (tooltipInfo.fields.has(k) ? k : null);

            if (!field) continue;
            const sanitized = sanitizeHoverValue(raw);

            if (sanitized === null || sanitized === undefined) continue;
            out[field] = sanitized;
          }

          return out;
        }

        return {};
      })();
      // A date the caller writes reads on the field's clock, as the chart's axis shows it.
      const fields = Object.fromEntries(
        Object.entries(requested).map(([field, value]) => {
          const clock = temporal.get(field);
          return [field, clock ? inputInstant(value, clock) : value];
        }),
      );
      return { clear, fields, requested, valueParam, markName };
    };
    actionRegistry.register(
      hoverDescriptor,
      async (prepared: ReturnType<typeof parseHover>) => {
        const { clear, fields, requested, valueParam, markName } = prepared;
        const viewAny = view;

        if (clear) {
          hover = null;

          // Best-effort: explicitly hide the tooltip via Vega's tooltip handler.
          try {
            if (typeof viewAny.tooltip === 'function') {
              const handler = viewAny.tooltip();

              if (typeof handler === 'function') {
                suppressed = true;
                handler(
                  null,
                  new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
                  null,
                  null,
                );
              }
            }
          } catch {
            // ignore
          } finally {
            queueMicrotask(() => {
              suppressed = false;
            });
          }

          return { cleared: true };
        }

        hover = {
          fields,
          markName,
          value: valueParam ?? null,
        };

        // Best-effort: programmatically show the tooltip for a matching mark.
        // This keeps semantic hover actions visible and stable in the UI.
        let tooltipShown = false;
        // Fields can match many marks while the tooltip shows one, so the result reports both.
        let tooltip: unknown = null;
        let matches = 0;
        const outcome = () => ({
          fields: requested,
          markName,
          value: valueParam ?? null,
          tooltipShown,
          tooltip,
          matches,
          // A miss says where to look instead: the marks this view draws and the fields they carry.
          ...(matches ? {} : { marks: sceneMarks(view, Object.keys(fields)) }),
        });

        try {
          const found = Object.keys(fields).length
            ? matchingSceneItems(view, fields, markName, Number.POSITIVE_INFINITY)
            : [];
          matches = found.length;
          if (typeof viewAny.tooltip !== 'function') return outcome();
          const tooltipHandler = viewAny.tooltip();

          if (typeof tooltipHandler !== 'function') return outcome();

          const target = root?.querySelector('canvas,svg');
          if (target && found.length) {
            const match = found[0];
            const bounds = match?.bounds;
            const x1 = Number(bounds?.x1);
            const y1 = Number(bounds?.y1);
            const x2 = Number(bounds?.x2);
            const y2 = Number(bounds?.y2);

            if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
              const offset = sceneOffset(match?.mark?.group);
              const point = scenePointToViewport(view, target, {
                x: offset.x + (x1 + x2) / 2,
                y: offset.y + (y1 + y2) / 2,
              });
              if (!point) return outcome();
              const { x: clientX, y: clientY } = point;
              suppressed = true;
              const tooltipValue = match?.tooltip ?? valueParam ?? (Object.keys(requested).length ? requested : null);
              tooltipHandler(
                null,
                new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY }),
                match,
                tooltipValue,
              );
              tooltipShown = tooltipValue != null;
              tooltip = tooltipValue ?? null;
            }
          }
        } catch {
          // ignore
        } finally {
          queueMicrotask(() => {
            suppressed = false;
          });
        }

        return outcome();
      },
      {
        parse: parseHover,
        focus: (prepared) => ({
          ref: vizRef,
          interaction: { kind: 'point' },
          detail: prepared.clear ? undefined : { fields: prepared.fields, markName: prepared.markName },
        }),
      },
    );
    actionDescriptors.push(hoverDescriptor);
  }

  return {
    fields: () => hover?.fields ?? null,
    subscribe(invalidate: () => void) {
      if (!hasTooltip || !view.addEventListener || !view.removeEventListener) return () => {};
      let lastKey: string | null = null;
      const update = (item: unknown) => {
        if (suppressed) return;
        const node = isRecord(item) ? item : undefined;
        const value = node?.tooltip;
        const mark = isRecord(node?.mark) ? node.mark : undefined;
        const markName = typeof mark?.name === 'string' ? mark.name : '';
        const key = value == null || value === '' ? null : `${markName}|${stableJson(value)}`;
        if (key === lastKey) return;
        lastKey = key;
        hover =
          key === null
            ? null
            : { fields: computeHoverFields({ tooltipInfo, allowed: null, item, value }), markName, value };
        invalidate();
      };
      const move = (_event: Event, item?: unknown) => update(item);
      const leave = () => update(undefined);
      view.addEventListener('pointermove', move);
      try {
        view.addEventListener('pointerout', leave);
      } catch (error) {
        view.removeEventListener('pointermove', move);
        throw error;
      }
      return () => {
        view.removeEventListener?.('pointermove', move);
        view.removeEventListener?.('pointerout', leave);
      };
    },
  };
}
