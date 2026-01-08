/**
 * Visualization layer (no VACP).
 *
 * This file is intentionally "boring": plain DOM + SVG.
 * The VACP integration is added as a separate layer in `vacp.ts`.
 */

export type Datum = { id: number; x: number; y: number; group: 'A' | 'B' | 'C' };

export function randomData(n = 80): Datum[] {
  // Use a loose grid + jitter so points are visually distinct and click targets
  // don't accidentally overlap (important for human interaction and tests).
  const out: Datum[] = [];
  const cols = Math.ceil(Math.sqrt(n * (800 / 480)));
  const rows = Math.ceil(n / cols);
  const jitter = 0.35;

  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const xBase = (col + 0.5) / cols;
    const yBase = (row + 0.5) / Math.max(1, rows);
    const x = (xBase + (Math.random() - 0.5) * (1 / cols) * jitter) * 100;
    const y = (yBase + (Math.random() - 0.5) * (1 / Math.max(1, rows)) * jitter) * 100;

    const group = i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C';
    out.push({ id: i + 1, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), group });
  }

  return out;
}

export function createScatterPlot(args: { root: HTMLElement; data: Datum[]; onToggle: (id: number) => void }): {
  svg: SVGSVGElement;
  update: (selectedIds: ReadonlySet<number>) => void;
} {
  const { root, data, onToggle } = args;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 800 480');

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', '800');
  bg.setAttribute('height', '480');
  bg.setAttribute('fill', '#ffffff');
  bg.setAttribute('rx', '10');
  svg.append(bg);

  const pad = 42;
  const xScale = (x: number) => pad + (x / 100) * (800 - pad * 2);
  const yScale = (y: number) => 480 - pad - (y / 100) * (480 - pad * 2);

  const axes = document.createElementNS(svgNS, 'g');
  axes.setAttribute('stroke', '#94a3b8');
  axes.setAttribute('stroke-width', '1');
  const xAxis = document.createElementNS(svgNS, 'line');
  xAxis.setAttribute('x1', String(pad));
  xAxis.setAttribute('y1', String(480 - pad));
  xAxis.setAttribute('x2', String(800 - pad));
  xAxis.setAttribute('y2', String(480 - pad));
  const yAxis = document.createElementNS(svgNS, 'line');
  yAxis.setAttribute('x1', String(pad));
  yAxis.setAttribute('y1', String(pad));
  yAxis.setAttribute('x2', String(pad));
  yAxis.setAttribute('y2', String(480 - pad));
  axes.append(xAxis, yAxis);
  svg.append(axes);

  const dots = document.createElementNS(svgNS, 'g');
  dots.setAttribute('stroke', 'rgba(15,23,42,0.25)');
  dots.setAttribute('stroke-width', '1');
  svg.append(dots);

  const circles = new Map<number, SVGCircleElement>();
  data.forEach((d) => {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', String(xScale(d.x)));
    c.setAttribute('cy', String(yScale(d.y)));
    c.dataset.id = String(d.id);
    c.style.cursor = 'pointer';
    c.addEventListener('click', () => onToggle(d.id));
    circles.set(d.id, c);
    dots.append(c);
  });

  root.replaceChildren(svg);

  const update = (selectedIds: ReadonlySet<number>) => {
    circles.forEach((c, id) => {
      const d = data[id - 1];
      const selected = selectedIds.has(id);
      c.setAttribute('r', selected ? '6.5' : '5');
      c.setAttribute('fill', d.group === 'A' ? '#2563eb' : d.group === 'B' ? '#16a34a' : '#f97316');
      c.setAttribute('opacity', selectedIds.size && !selected ? '0.25' : '0.92');
    });
  };

  return { svg, update };
}
