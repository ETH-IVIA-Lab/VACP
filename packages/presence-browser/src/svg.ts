/** Avoid invalidating SVG rendering when an observation leaves the visual unchanged. */
export function updateAttribute(element: SVGElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
