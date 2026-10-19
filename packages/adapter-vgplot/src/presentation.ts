import type { PresencePresentation, PresenceResolver } from '@ethivia/vacp-presence-core';
import { elementPresenceTarget, observePresenceLayout, svgPresenceTarget } from '@ethivia/vacp-presence-core/dom';
import { providerBindings } from './provider-bindings';
import type { VacpProvider } from '@ethivia/vacp-protocol';
import { intervalDomainValue } from './interactors/interval';

/** Project semantic interaction refs through the live interactor's scales and facet groups. */
export function createVgplotPresentation(args: { provider: VacpProvider; root: Element }): PresencePresentation {
  const bindings = providerBindings.get(args.provider);
  if (!bindings) throw new Error('VGPlot presentation requires a live VGPlot provider');
  const resolve: PresenceResolver = (focus, { signal }) => {
    signal.throwIfAborted();
    const binding = bindings.byRef.get(focus.ref);
    if (!binding) return null;
    if (binding.kind === 'input') {
      const { input, element } = binding.input;
      return elementPresenceTarget(input.searchbox ?? input.slider ?? input.select ?? element, 'exact');
    }
    if (binding.kind === 'table') {
      const { table } = binding;
      if (!table.element) return null;
      const detail =
        focus.detail && typeof focus.detail === 'object' ? (focus.detail as { column?: unknown }) : undefined;
      const index = table.schema?.findIndex((field) => field.column === detail?.column) ?? -1;
      const header = index >= 0 ? table.element.querySelectorAll('thead th')[index] : undefined;
      return elementPresenceTarget(header ?? table.element, header ? 'exact' : 'surface');
    }
    if (binding.kind === 'legend') {
      const { legend } = binding;
      if (legend.element) {
        const detail =
          focus.detail && typeof focus.detail === 'object' ? (focus.detail as { value?: unknown }) : undefined;
        const value = Array.isArray(detail?.value)
          ? detail.value.length === 1
            ? [detail.value[0]].flat()[0]
            : undefined
          : detail?.value;
        const items = legend.legend?.querySelectorAll<HTMLElement & { __data__?: unknown }>(
          ':scope > div, :scope > span',
        );
        const item =
          value == null ? undefined : Array.from(items ?? []).find((element) => Object.is(element.__data__, value));
        return elementPresenceTarget(item ?? legend.element, item ? 'exact' : 'region');
      }
      return null;
    }
    if (binding.kind === 'plot') return binding.plot.element ? elementPresenceTarget(binding.plot.element) : null;
    if (binding.kind === 'interactor') {
      const { interactor, plot, type } = binding;
      const element = plot.element;
      if (!element) return null;
      const detail = focus.detail && typeof focus.detail === 'object' ? (focus.detail as Record<string, unknown>) : {};
      const groups = interactor.g?.nodes?.() ?? [];
      // Faceted interactors own several groups. Select a visible group without guessing a global offset.
      const group = groups.find((node) => elementPresenceTarget(node));
      if (!group) return elementPresenceTarget(element);
      const overlay = group.querySelector<SVGRectElement>('rect.overlay');
      if (!overlay) return elementPresenceTarget(group);
      const box = overlay.getBBox();
      let x = [box.x, box.x + box.width],
        y = [box.y, box.y + box.height];
      let projected = false;
      // A brush step projects its data-domain extent through the rendered scales; other interactors
      // outline the plot area they act on.
      if (type === 'Interval1D' && interactor.scale && detail.min !== undefined && detail.max !== undefined) {
        const values = [detail.min, detail.max].map((value) =>
          interactor.scale!.apply(intervalDomainValue(value, interactor.scale)),
        );
        if (interactor.channel === 'y') y = values;
        else x = values;
        projected = true;
      } else if (
        type === 'Interval2D' &&
        interactor.xscale &&
        interactor.yscale &&
        detail.x0 !== undefined &&
        detail.x1 !== undefined &&
        detail.y0 !== undefined &&
        detail.y1 !== undefined
      ) {
        x = [detail.x0, detail.x1].map((value) =>
          interactor.xscale!.apply(intervalDomainValue(value, interactor.xscale)),
        );
        y = [detail.y0, detail.y1].map((value) =>
          interactor.yscale!.apply(intervalDomainValue(value, interactor.yscale)),
        );
        projected = true;
      }
      if (!projected || ![...x, ...y].every(Number.isFinite)) return elementPresenceTarget(group, 'region');
      return svgPresenceTarget(group, {
        kind: 'region',
        x: Math.min(...x),
        y: Math.min(...y),
        width: Math.abs(x[1]! - x[0]!),
        height: Math.abs(y[1]! - y[0]!),
      });
    }
    return null;
  };
  return { resolve, subscribe: (invalidate) => observePresenceLayout(args.root, invalidate) };
}
