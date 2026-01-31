import { svgArea } from './utils.js';
import type { ArenaReportTheme } from './types.js';

export function plotSvg(args: { plot: unknown; theme: ArenaReportTheme }) {
  const svg = extractSvg(args.plot);
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // Ensure the SVG has an explicit background so exported PNGs and SVG viewers
  // don't render transparency as black in some contexts.
  const bg = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#ffffff');
  svg.insertBefore(bg, svg.firstChild);

  const w = svg.getAttribute('width');
  const h = svg.getAttribute('height');
  if (w && h && !svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  svg.style.fontFamily = args.theme.fontFamily;
  svg.style.fontSize = `${args.theme.fontSizePx}px`;
  svg.style.color = args.theme.colors.ink;
  return svg.outerHTML.trim() + '\n';
}

function extractSvg(el: unknown): SVGSVGElement {
  if (el && typeof el === 'object' && (el as any).tagName === 'svg') return el as SVGSVGElement;
  const all = Array.from(((el as any)?.querySelectorAll?.('svg') ?? []) as SVGSVGElement[]);
  if (all.length === 1) return all[0];
  if (all.length > 1) {
    // Plot with legends returns a <figure> that contains multiple SVGs (e.g. swatches + main plot).
    // Choose the largest by area to reliably pick the main plot.
    let best = all[0];
    let bestArea = svgArea(best);
    for (const s of all.slice(1)) {
      const area = svgArea(s);
      if (area > bestArea) {
        best = s;
        bestArea = area;
      }
    }
    return best;
  }
  throw new Error('Expected Plot.plot() to return an <svg> (or contain one).');
}
