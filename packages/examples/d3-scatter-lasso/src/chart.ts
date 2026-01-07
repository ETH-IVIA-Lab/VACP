/**
 * Visualization layer (no VACP).
 *
 * This is a plain D3 scatterplot with a freehand lasso.
 * The lasso polygon is stored in *domain coordinates* so it can be manipulated
 * programmatically (agent-style) without pixel automation.
 */

import * as d3 from 'd3';

export type Point = { id: string; x: number; y: number };
export type DomainPoint = { x: number; y: number };

export function makePoints(n = 250): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ id: `p${i}`, x: Math.random() * 100, y: Math.random() * 100 });
  }
  return pts;
}

export function createLassoScatterChart(args: {
  root: HTMLElement;
  width?: number;
  height?: number;
  data: Point[];
  onSelectionChanged?: () => void;
}): {
  svg: SVGSVGElement;
  setLassoPolygon: (poly: DomainPoint[] | null) => void;
  getLassoPolygon: () => DomainPoint[] | null;
  clearSelection: () => void;
  getSelectedIds: () => string[];
  getSelectedCount: () => number;
  render: () => void;
} {
  const width = args.width ?? 640;
  const height = args.height ?? 420;
  const margin = { top: 18, right: 18, bottom: 30, left: 36 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const x = d3.scaleLinear().domain([0, 100]).range([0, innerW]).nice();
  const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]).nice();

  let lassoPolygonDomain: DomainPoint[] | null = null;
  let selectedIds = new Set<string>();

  const svg = d3
    .select(args.root)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);
  const svgEl = svg.node()!;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));

  const dots = g.append('g');
  const lasso = g
    .append('path')
    .attr('fill', 'rgba(59,130,246,0.08)')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 1.25);

  const lassoPointsPx: Array<[number, number]> = [];

  const computeSelection = () => {
    selectedIds = new Set<string>();
    if (!lassoPolygonDomain || lassoPolygonDomain.length < 3) return;
    const polyPx = lassoPolygonDomain.map((p) => [x(p.x), y(p.y)] as [number, number]);
    args.data.forEach((p) => {
      const px: [number, number] = [x(p.x), y(p.y)];
      if (d3.polygonContains(polyPx, px)) selectedIds.add(p.id);
    });
  };

  const render = () => {
    computeSelection();
    dots
      .selectAll('circle')
      .data(args.data, (d) => (d as Point).id)
      .join('circle')
      .attr('cx', (d) => x(d.x))
      .attr('cy', (d) => y(d.y))
      .attr('r', 3.4)
      .attr('fill', (d) => (selectedIds.has(d.id) ? '#1d4ed8' : '#64748b'))
      .attr('fill-opacity', (d) => (selectedIds.has(d.id) ? 0.95 : 0.35));

    if (!lassoPolygonDomain || lassoPolygonDomain.length < 3) {
      lasso.attr('d', '');
    } else {
      const d = lassoPolygonDomain.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x)},${y(p.y)}`).join(' ') + ' Z';
      lasso.attr('d', d);
    }
  };

  const clearSelection = () => {
    lassoPolygonDomain = null;
    selectedIds = new Set<string>();
    render();
  };

  const setLassoPolygon = (poly: DomainPoint[] | null) => {
    lassoPolygonDomain = poly;
    render();
  };

  // Human interaction: freehand lasso in pixel space, converted to domain on commit.
  svg.on('pointerdown', (event) => {
    lassoPointsPx.length = 0;
    const [px, py] = d3.pointer(event, g.node() as SVGGElement);
    lassoPointsPx.push([px, py]);
    svgEl.setPointerCapture((event as PointerEvent).pointerId);
  });
  svg.on('pointermove', (event) => {
    if (!svgEl.hasPointerCapture((event as PointerEvent).pointerId)) return;
    const [px, py] = d3.pointer(event, g.node() as SVGGElement);
    lassoPointsPx.push([px, py]);
    if (lassoPointsPx.length < 3) return;
    const d = lassoPointsPx.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
    lasso.attr('d', d);
  });
  svg.on('pointerup', (event) => {
    if (!svgEl.hasPointerCapture((event as PointerEvent).pointerId)) return;
    svgEl.releasePointerCapture((event as PointerEvent).pointerId);
    if (lassoPointsPx.length < 3) {
      clearSelection();
      args.onSelectionChanged?.();
      return;
    }
    const polyDomain: DomainPoint[] = lassoPointsPx.map(([px, py]) => ({ x: x.invert(px), y: y.invert(py) }));
    setLassoPolygon(polyDomain);
    args.onSelectionChanged?.();
  });

  return {
    svg: svgEl,
    setLassoPolygon,
    getLassoPolygon: () => lassoPolygonDomain,
    clearSelection,
    getSelectedIds: () => Array.from(selectedIds),
    getSelectedCount: () => selectedIds.size,
    render,
  };
}
