import { createElement, icons } from 'lucide';

export type VacpLucideIconName = keyof typeof icons;

export function renderLucideIcon(
  name: VacpLucideIconName,
  opts?: { size?: number; className?: string; title?: string },
): SVGSVGElement {
  const node = icons[name];
  // `createElement` uses `document`, so this is browser-only by design.
  const svg = createElement(node, {
    width: opts?.size ?? 16,
    height: opts?.size ?? 16,
    class: opts?.className ?? 'vacp-debug-ui-icon',
    'aria-hidden': opts?.title ? undefined : 'true',
    role: opts?.title ? 'img' : 'presentation',
  }) as SVGSVGElement;

  if (opts?.title) {
    svg.setAttribute('aria-label', opts.title);
    svg.setAttribute('focusable', 'false');
  }

  return svg;
}

