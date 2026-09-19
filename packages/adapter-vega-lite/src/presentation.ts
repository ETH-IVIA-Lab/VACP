import type { PresenceGeometry, PresenceResolver, PresenceTarget } from '@vacp/presence-core';
import { browserPresenceSurface, elementPresenceTarget, observePresenceLayout } from '@vacp/presence-browser/targets';
import { createVegaLiteBindings } from './bindings';
import { makeRef } from './refs';
import { matchingSceneItems, sceneOffset, scenePointToViewport } from './scene';
import type { VegaLiteProviderOptions, VegaLiteSpecLike, VegaViewLike } from './types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function project(view: VegaViewLike, root: HTMLElement, geometry: PresenceGeometry): PresenceTarget | null {
  const target = root.querySelector('canvas,svg');
  if (!target || !elementPresenceTarget(target)) return null;
  const points =
    geometry.kind === 'point'
      ? [geometry.point]
      : geometry.kind === 'path'
        ? geometry.points
        : [
            { x: geometry.x, y: geometry.y },
            { x: geometry.x + geometry.width, y: geometry.y },
            { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
            { x: geometry.x, y: geometry.y + geometry.height },
            { x: geometry.x, y: geometry.y },
          ];
  const mapped = points.map((point) => scenePointToViewport(view, target, point));
  if (mapped.some((point) => point === null)) return null;
  return {
    surface: browserPresenceSurface,
    precision: 'exact',
    geometry: { kind: 'path', points: mapped.filter((point) => point !== null) },
  };
}

function projectDatum(
  view: VegaViewLike,
  root: HTMLElement,
  fields: Record<string, unknown>,
  markName?: string,
  markTypes?: ReadonlySet<string>,
): PresenceTarget | null {
  const matches = matchingSceneItems(view, fields, markName, 2, markTypes);
  if (matches.length !== 1) return null;
  const item = matches[0]!,
    bounds = item.bounds!,
    offset = sceneOffset(item.mark?.group);
  return project(view, root, {
    kind: 'region',
    x: bounds.x1 + offset.x,
    y: bounds.y1 + offset.y,
    width: bounds.x2 - bounds.x1,
    height: bounds.y2 - bounds.y1,
  });
}

/** Optional browser projection. Semantic provider creation does not install presentation. */
export function createVegaLitePresentation(args: {
  view: VegaViewLike;
  root: HTMLElement;
  spec: VegaLiteSpecLike;
  options: VegaLiteProviderOptions;
}): { resolve: PresenceResolver; subscribe: (invalidate: () => void) => () => void } {
  const { view, root, spec, options } = args;
  const bindings = createVegaLiteBindings(spec, view, options);
  const vizRef = makeRef({ ...options, suffix: '' });
  const resolve: PresenceResolver = (focus, { signal }) => {
    signal.throwIfAborted();
    if (!elementPresenceTarget(root)) return null;
    const detail = record(focus.detail);
    const binding = bindings.paramByRef.get(focus.ref);
    const param = binding?.param;
    if (focus.ref === vizRef) {
      const fields = record(detail?.fields);
      return (
        (fields
          ? projectDatum(view, root, fields, typeof detail?.markName === 'string' ? detail.markName : undefined)
          : null) ?? elementPresenceTarget(root)
      );
    }
    if (param && !param.select) {
      // Vega binds generated controls by signal name. Avoid interpolating untrusted selectors.
      const control = [...root.querySelectorAll('input,select,textarea')].find(
        (element) => element.getAttribute('name') === param.name,
      );
      return control ? elementPresenceTarget(control, 'exact') : elementPresenceTarget(root);
    }
    if (param) {
      const value = record(detail?.value);
      for (const context of binding!.contexts()) {
        const fields = record(context.signals?.[`${param.name}_tuple_fields`])?.value;
        if (!Array.isArray(fields)) continue;
        const group = context.group;
        const offset = sceneOffset(group);
        const width = group?.width ?? view.width?.(),
          height = group?.height ?? view.height?.();
        if (width === undefined || height === undefined) continue;
        let x = [0, width],
          y = [0, height],
          projected = false;
        for (const field of fields) {
          const f = record(field);
          const channel = f?.channel;
          if (channel !== 'x' && channel !== 'y') continue;
          const range = value?.[channel] ?? (typeof f?.field === 'string' ? value?.[f.field] : undefined);
          if (!Array.isArray(range) || range.length !== 2) continue;
          const unit = group?.mark?.name?.replace(/_group$/, '');
          const scale =
            context.scales?.[channel]?.value ?? (unit ? context.scales?.[`${unit}_${channel}`]?.value : undefined);
          if (!scale) continue;
          const pixels = range.map(scale);
          if (!pixels.every(Number.isFinite)) continue;
          if (channel === 'x') x = pixels;
          else y = pixels;
          projected = true;
        }
        if (projected) {
          const target = project(view, root, {
            kind: 'region',
            x: offset.x + Math.min(...x),
            y: offset.y + Math.min(...y),
            width: Math.abs(x[1]! - x[0]!),
            height: Math.abs(y[1]! - y[0]!),
          });
          if (target) return target;
        }
      }
      // Point selections use rendered marks; aggregate or absent records stay at surface precision.
      const fields = record(detail?.value);
      if (fields) {
        const target = projectDatum(view, root, fields, undefined, binding!.markTypes);
        if (target) return target;
      }
      return elementPresenceTarget(root);
    }
    return null;
  };
  return { resolve, subscribe: (invalidate) => observePresenceLayout(root, invalidate) };
}
