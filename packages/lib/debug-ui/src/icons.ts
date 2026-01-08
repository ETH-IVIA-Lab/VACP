import { createElement, icons } from 'lucide';

export type VacpLucideIconName = keyof typeof icons;

export function renderLucideIcon(
  name: VacpLucideIconName,
  opts?: { size?: number; className?: string; title?: string },
): SVGSVGElement {
  const node = icons[name];
  // `createElement` uses `document`, so this is browser-only by design.
  const attrs: Record<string, string | number> = {
    width: opts?.size ?? 16,
    height: opts?.size ?? 16,
    class: opts?.className ?? 'vacp-debug-ui-icon',
  };
  if (opts?.title) {
    attrs.role = 'img';
    attrs['aria-label'] = opts.title;
  } else {
    attrs.role = 'presentation';
    attrs['aria-hidden'] = 'true';
  }

  const svg = createElement(node, attrs) as SVGSVGElement;
  svg.setAttribute('focusable', 'false');

  return svg;
}
