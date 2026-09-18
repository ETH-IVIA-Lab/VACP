import { estimateTextWidthPx, svgArea } from './utils.js';
import type { ArenaReportTheme } from './types.js';

type SvgLegendSwatchItem = {
  label: string;
  fill: string;
  stroke?: string;
};

type SvgLegendSwatches = {
  kind?: 'swatches';
  title?: string;
  items: SvgLegendSwatchItem[];
};

type SvgLegendRamp = {
  kind: 'ramp';
  title?: string;
  continuous?: boolean;
  segments: Array<{
    from: number;
    to: number;
    fill: string;
  }>;
  stops?: Array<{
    value: number;
    fill: string;
  }>;
  ticks: Array<{
    value: number;
    label: string;
  }>;
  extras?: SvgLegendSwatchItem[];
};

export type SvgLegend = SvgLegendSwatches | SvgLegendRamp;

let rampGradientSeq = 0;

export function plotSvg(args: { plot: Element; theme: ArenaReportTheme; legend?: SvgLegend | null }) {
  const { svg, legend } = extractSvgAndLegend(args.plot);
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // Ensure the SVG has an explicit background so exported PNGs and SVG viewers
  // don't render transparency as black in some contexts.
  const bg = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#f4f5f5');
  svg.insertBefore(bg, svg.firstChild);

  const w = svg.getAttribute('width');
  const h = svg.getAttribute('height');

  if (w && h && !svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  svg.style.fontFamily = args.theme.fontFamily;
  svg.style.fontSize = `${args.theme.fontSizePx}px`;
  svg.style.color = args.theme.colors.ink;

  const finalLegend = args.legend ?? legend ?? null;

  if (finalLegend) {
    const hasContent =
      finalLegend.kind === 'ramp'
        ? finalLegend.segments.length > 0 || (Array.isArray(finalLegend.stops) && finalLegend.stops.length > 0)
        : Array.isArray(finalLegend.items) && finalLegend.items.length > 0;

    if (hasContent) appendLegend(svg, finalLegend, args.theme);
  }

  return svg.outerHTML.trim() + '\n';
}

function extractSvgAndLegend(el: Element): { svg: SVGSVGElement; legend: SvgLegend | null } {
  if (el && typeof el === 'object' && el.tagName === 'svg') return { svg: el as SVGSVGElement, legend: null };
  const root = el;
  const all = Array.from(root.querySelectorAll('svg'));

  if (all.length === 1) return { svg: all[0], legend: null };

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

    const legend = extractSwatchLegend(root);

    return { svg: best, legend };
  }

  throw new Error('Expected Plot.plot() to return an <svg> (or contain one).');
}

function extractSwatchLegend(root: Element): SvgLegend | null {
  if (!root || typeof root !== 'object') return null;

  if (root.tagName === 'svg') return null;

  const container = root.querySelector?.('[class*="swatches"]');

  if (!container) return null;

  const items: SvgLegendSwatchItem[] = [];
  const spans = Array.from(container.querySelectorAll('span'));

  for (const span of spans) {
    const svg = span.querySelector('svg');

    if (!svg) continue;
    const fill = svg.getAttribute('fill') || svg.style.fill || '';
    const stroke = svg.getAttribute('stroke') || svg.style.stroke || undefined;
    const label = String(span.textContent || '').trim();

    if (!label) continue;

    if (!fill && !stroke) continue;
    items.push({ label, fill: fill || stroke || '#000000', ...(stroke ? { stroke } : {}) });
  }

  if (!items.length) return null;

  return { kind: 'swatches', items };
}

function appendLegend(svg: SVGSVGElement, legend: SvgLegend, theme: ArenaReportTheme) {
  const size = parseSvgSize(svg);

  if (!size) return;

  const fontSizePx = theme.fontSizePx;
  const paddingX = 12;
  const paddingY = 10;
  const gapAboveLegend = 12;
  const rowHeight = Math.round(fontSizePx * 1.25);
  const maxRowWidth = Math.max(160, size.width - paddingX * 2);

  const doc = svg.ownerDocument;
  const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('aria-label', 'legend');
  g.setAttribute('text-anchor', 'start');

  let y = paddingY;

  if (legend.title) {
    const title = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', String(paddingX));
    title.setAttribute('y', String(y));
    title.setAttribute('dominant-baseline', 'hanging');
    title.setAttribute('font-weight', '600');
    title.textContent = legend.title;
    g.appendChild(title);
    y += rowHeight + 4;
  }

  if (legend.kind === 'ramp') {
    y = renderRampLegend(g, legend, theme, {
      x: paddingX,
      y,
      maxRowWidth,
    });
  } else {
    y = renderSwatchesLegend(g, legend.items, theme, {
      x: paddingX,
      y,
      maxRowWidth,
    });
  }

  const legendHeight = y + paddingY;
  g.setAttribute('transform', `translate(0, ${size.height + gapAboveLegend})`);
  svg.appendChild(g);

  const newHeight = size.height + gapAboveLegend + legendHeight;
  svg.setAttribute('height', String(Math.round(newHeight)));

  const vb = svg.getAttribute('viewBox');

  if (vb) {
    const parts = vb.trim().split(/\s+/g).map(Number);

    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      svg.setAttribute('viewBox', `${parts[0]} ${parts[1]} ${parts[2]} ${newHeight}`);
    }
  } else {
    svg.setAttribute('viewBox', `0 0 ${size.width} ${newHeight}`);
  }
}

function renderSwatchesLegend(
  g: SVGGElement,
  items: SvgLegendSwatchItem[],
  theme: ArenaReportTheme,
  layout: { x: number; y: number; maxRowWidth: number },
) {
  const fontSizePx = theme.fontSizePx;
  const swatchSize = 12;
  const swatchTextGap = 6;
  const colGap = 14;
  const rowGap = 6;
  const rowHeight = Math.max(swatchSize, Math.round(fontSizePx * 1.25));

  const lines: SvgLegendSwatchItem[][] = [];
  let cur: SvgLegendSwatchItem[] = [];
  let curWidth = 0;

  for (const item of items) {
    const textWidth = estimateTextWidthPx(item.label, fontSizePx);
    const itemWidth = swatchSize + swatchTextGap + textWidth;
    const nextWidth = cur.length ? curWidth + colGap + itemWidth : itemWidth;

    if (cur.length && nextWidth > layout.maxRowWidth) {
      lines.push(cur);
      cur = [item];
      curWidth = itemWidth;
    } else {
      cur.push(item);
      curWidth = nextWidth;
    }
  }

  if (cur.length) lines.push(cur);

  const doc = g.ownerDocument;
  let y = layout.y;

  for (const row of lines) {
    let x = layout.x;

    for (const item of row) {
      const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y + (rowHeight - swatchSize) / 2));
      rect.setAttribute('width', String(swatchSize));
      rect.setAttribute('height', String(swatchSize));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', item.fill);

      const autoStroke =
        item.fill.toLowerCase() === '#ffffff' || item.fill.toLowerCase() === 'white' ? theme.colors.grid : '';

      const stroke = item.stroke ?? autoStroke;

      if (stroke) rect.setAttribute('stroke', stroke);
      g.appendChild(rect);

      const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x + swatchSize + swatchTextGap));
      text.setAttribute('y', String(y + rowHeight / 2));
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = item.label;
      g.appendChild(text);

      const textWidth = estimateTextWidthPx(item.label, fontSizePx);
      x += swatchSize + swatchTextGap + textWidth + colGap;
    }

    y += rowHeight + rowGap;
  }

  if (lines.length) y -= rowGap;

  return y;
}

function renderRampLegend(
  g: SVGGElement,
  legend: SvgLegendRamp,
  theme: ArenaReportTheme,
  layout: { x: number; y: number; maxRowWidth: number },
) {
  const fontSizePx = theme.fontSizePx;
  const tickFontSize = Math.max(9, Math.round(fontSizePx * 0.9));
  const barHeight = 12;
  const tickSize = 6;
  const tickLabelGap = 3;
  const maxRowWidth = layout.maxRowWidth;
  const barWidth = maxRowWidth;

  const domain = inferRampDomain(legend.segments, legend.stops);

  const scale = (value: number) => {
    if (!Number.isFinite(domain.max) || !Number.isFinite(domain.min) || domain.max <= domain.min) return layout.x;
    const t = (value - domain.min) / (domain.max - domain.min);

    return layout.x + barWidth * Math.max(0, Math.min(1, t));
  };

  const doc = g.ownerDocument;
  const barY = layout.y;

  if (legend.continuous && legend.stops && legend.stops.length >= 2 && domain.max > domain.min) {
    const defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = doc.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    const gradientId = `legend-ramp-${rampGradientSeq++}`;
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '0%');
    const stops = [...legend.stops].sort((a, b) => a.value - b.value);

    for (const stop of stops) {
      const t = (stop.value - domain.min) / (domain.max - domain.min);
      const offset = Math.max(0, Math.min(1, t)) * 100;
      const stopEl = doc.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stopEl.setAttribute('offset', `${offset}%`);
      stopEl.setAttribute('stop-color', stop.fill);
      gradient.appendChild(stopEl);
    }

    defs.appendChild(gradient);
    g.appendChild(defs);

    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(layout.x));
    rect.setAttribute('y', String(barY));
    rect.setAttribute('width', String(barWidth));
    rect.setAttribute('height', String(barHeight));
    rect.setAttribute('fill', `url(#${gradientId})`);
    g.appendChild(rect);
  } else {
    for (const [index, segment] of legend.segments.entries()) {
      const x0 = scale(segment.from);
      const x1 = scale(segment.to);
      const left = Math.min(x0, x1);
      const baseWidth = Math.max(0, Math.abs(x1 - x0));
      // Slight overlap avoids anti-alias hairline seams between adjacent bins.
      const width = baseWidth + (index < legend.segments.length - 1 ? 0.5 : 0);

      if (width <= 0.5) continue;
      const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(left));
      rect.setAttribute('y', String(barY));
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('fill', segment.fill);
      g.appendChild(rect);
    }
  }

  const outline = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  outline.setAttribute('x', String(layout.x));
  outline.setAttribute('y', String(barY));
  outline.setAttribute('width', String(barWidth));
  outline.setAttribute('height', String(barHeight));
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', theme.colors.grid);
  g.appendChild(outline);

  const tickY1 = barY + barHeight;
  const tickY2 = tickY1 + tickSize;
  const tickLabelY = tickY2 + tickLabelGap;
  const ticks = layoutRampTicks(legend.ticks, domain, scale, tickFontSize);

  for (const t of ticks) {
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(t.x));
    line.setAttribute('x2', String(t.x));
    line.setAttribute('y1', String(tickY1));
    line.setAttribute('y2', String(tickY2));
    line.setAttribute('stroke', theme.colors.ink);
    g.appendChild(line);

    const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(t.x));
    text.setAttribute('y', String(tickLabelY));
    text.setAttribute('dominant-baseline', 'hanging');
    text.setAttribute('text-anchor', t.anchor);
    text.setAttribute('font-size', String(tickFontSize));
    text.textContent = t.label;
    g.appendChild(text);
  }

  let y = tickLabelY + Math.round(tickFontSize * 1.2);

  if (legend.extras && legend.extras.length) {
    y += 10;
    y = renderSwatchesLegend(g, legend.extras, theme, { x: layout.x, y, maxRowWidth });
  }

  return y;
}

function inferRampDomain(
  segments: Array<{ from: number; to: number }>,
  stops?: Array<{ value: number; fill: string }>,
) {
  let min = Infinity;
  let max = -Infinity;

  if (Array.isArray(stops)) {
    for (const stop of stops) {
      if (!Number.isFinite(stop.value)) continue;

      if (stop.value < min) min = stop.value;

      if (stop.value > max) max = stop.value;
    }
  }

  for (const s of segments) {
    if (Number.isFinite(s.from)) min = Math.min(min, s.from);

    if (Number.isFinite(s.to)) max = Math.max(max, s.to);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };

  if (max < min) return { min: max, max: min };

  return { min, max };
}

function layoutRampTicks(
  ticks: SvgLegendRamp['ticks'],
  domain: { min: number; max: number },
  scale: (value: number) => number,
  fontSizePx: number,
) {
  const candidates = ticks
    .filter((t) => Number.isFinite(t.value))
    .filter((t) => domain.max <= domain.min || (t.value >= domain.min && t.value <= domain.max))
    .map((t) => ({ ...t, x: scale(t.value) }))
    .sort((a, b) => a.value - b.value);

  if (!candidates.length) return [];

  const minGap = 6;
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const uniqueLast = first.value !== last.value || first.label !== last.label;

  const firstBounds = tickBounds(first.x, first.label, 'start', fontSizePx);
  const lastBounds = tickBounds(last.x, last.label, 'end', fontSizePx);

  const out: Array<{ x: number; label: string; anchor: 'start' | 'middle' | 'end' }> = [
    { x: first.x, label: first.label, anchor: 'start' },
  ];

  let prevEnd = firstBounds.end;
  const lastStart = lastBounds.start;

  for (const t of candidates.slice(1, -1)) {
    const bounds = tickBounds(t.x, t.label, 'middle', fontSizePx);

    if (bounds.start < prevEnd + minGap) continue;

    if (bounds.end > lastStart - minGap) continue;
    out.push({ x: t.x, label: t.label, anchor: 'middle' });
    prevEnd = bounds.end;
  }

  if (uniqueLast) out.push({ x: last.x, label: last.label, anchor: 'end' });

  return out;
}

function tickBounds(x: number, label: string, anchor: 'start' | 'middle' | 'end', fontSizePx: number) {
  const w = estimateTextWidthPx(label, fontSizePx);

  if (anchor === 'start') return { start: x, end: x + w };

  if (anchor === 'end') return { start: x - w, end: x };

  return { start: x - w / 2, end: x + w / 2 };
}

function parseSvgSize(svg: SVGSVGElement) {
  const w = Number(String(svg.getAttribute('width') ?? '').replace(/px$/g, ''));
  const h = Number(String(svg.getAttribute('height') ?? '').replace(/px$/g, ''));

  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h };
  const vb = svg.getAttribute('viewBox');

  if (!vb) return null;
  const parts = vb.trim().split(/\s+/g).map(Number);

  if (parts.length !== 4) return null;
  const width = parts[2];
  const height = parts[3];

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;

  return { width, height };
}
