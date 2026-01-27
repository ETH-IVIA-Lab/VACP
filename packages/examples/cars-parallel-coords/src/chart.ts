import * as d3 from 'd3';

export type BrushRange = [number, number];
export type BrushRanges = Record<string, BrushRange>;

export type ParallelCoordsSource = 'human' | 'agent' | 'system';

export type ParallelCoordsState = {
  dimensions: string[];
  dimensionOrder: string[];
  brushRanges: BrushRanges;
  selectedCount: number;
  totalCount: number;
  hoveredId: number | null;
};

export type CarDatum = Record<string, number | string> & {
  id: number;
  Car: string;
  Origin: string;
};

function clampNumber(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampRange(range: BrushRange, lo: number, hi: number): BrushRange {
  const a = clampNumber(range[0], lo, hi);
  const b = clampNumber(range[1], lo, hi);
  return a <= b ? [a, b] : [b, a];
}

function toNumber(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fullExtent(data: CarDatum[], dim: string): BrushRange {
  const ex = d3.extent(data, (d) => toNumber(d[dim])) as [number | undefined, number | undefined];
  const lo = Number.isFinite(ex[0] ?? NaN) ? (ex[0] as number) : 0;
  const hi = Number.isFinite(ex[1] ?? NaN) ? (ex[1] as number) : 0;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

export function createParallelCoordsChart(args: {
  root: HTMLElement;
  tooltip: HTMLElement;
  data: CarDatum[];
  dimensions: string[];
  onStateChange?: (state: ParallelCoordsState, change: { source: ParallelCoordsSource; message: string }) => void;
}) {
  const lineStroke = '#a8d5e2';
  const lineStrokeWidth = 2;
  const lineStrokeWidthHovered = 3;

  const margin = { top: 30, right: 50, bottom: 30, left: 50 };
  const height = 400;

  let dimensionSpacing = 200;
  const dimensionOrder: string[] = [];

  const extents: BrushRanges = Object.fromEntries(args.dimensions.map((d) => [d, fullExtent(args.data, d)]));
  const brushRanges: BrushRanges = Object.fromEntries(args.dimensions.map((d) => [d, extents[d]!]));
  const selectedIds = new Set<number>(args.data.map((d) => d.id));
  let hoveredId: number | null = null;

  const getOrderedDimensions = (): string[] => (dimensionOrder.length ? [...dimensionOrder] : [...args.dimensions]);

  const getState = (): ParallelCoordsState => ({
    dimensions: [...args.dimensions],
    dimensionOrder: getOrderedDimensions(),
    brushRanges: structuredClone(brushRanges),
    selectedCount: selectedIds.size,
    totalCount: args.data.length,
    hoveredId,
  });

  const emit = (source: ParallelCoordsSource, message: string) => {
    args.onStateChange?.(getState(), { source, message });
  };

  const computeSelection = (): void => {
    selectedIds.clear();

    for (const d of args.data) {
      let ok = true;
      for (const dim of args.dimensions) {
        const range = brushRanges[dim];
        if (!range) continue;
        const [min, max] = range;
        const v = toNumber(d[dim]);
        if (v < min || v > max) {
          ok = false;
          break;
        }
      }
      if (ok) selectedIds.add(d.id);
    }
  };

  const showTooltip = (event: MouseEvent, d: CarDatum): void => {
    hoveredId = d.id;
    const ordered = getOrderedDimensions();
    let html = `<strong>${String(d.Car || 'Unknown')}</strong><br>`;
    if (d.Origin) html += `Origin: ${String(d.Origin)}<br><br>`;
    for (const dim of ordered) {
      const v = d[dim];
      if (v === undefined || v === null) continue;
      html += `${dim}: ${typeof v === 'number' ? v.toFixed(2) : String(v)}<br>`;
    }
    args.tooltip.innerHTML = html;
    args.tooltip.style.display = 'block';
    args.tooltip.style.left = `${event.pageX + 10}px`;
    args.tooltip.style.top = `${event.pageY - 10}px`;
  };

  const showTooltipAt = (pageX: number, pageY: number, d: CarDatum): void => {
    const ordered = getOrderedDimensions();
    let html = `<strong>${String(d.Car || 'Unknown')}</strong><br>`;
    if (d.Origin) html += `Origin: ${String(d.Origin)}<br><br>`;
    for (const dim of ordered) {
      const v = d[dim];
      if (v === undefined || v === null) continue;
      html += `${dim}: ${typeof v === 'number' ? v.toFixed(2) : String(v)}<br>`;
    }
    args.tooltip.innerHTML = html;
    args.tooltip.style.display = 'block';
    args.tooltip.style.left = `${pageX + 10}px`;
    args.tooltip.style.top = `${pageY - 10}px`;
  };

  const moveTooltip = (event: MouseEvent): void => {
    args.tooltip.style.left = `${event.pageX + 10}px`;
    args.tooltip.style.top = `${event.pageY - 10}px`;
  };

  const hideTooltip = (): void => {
    hoveredId = null;
    args.tooltip.style.display = 'none';
  };

  const render = (): void => {
    d3.select(args.root).selectAll('*').remove();

    if (hoveredId !== null && !selectedIds.has(hoveredId)) {
      hoveredId = null;
      hideTooltip();
    }

    const containerWidth = args.root.getBoundingClientRect().width || 1200;
    const ordered = getOrderedDimensions();
    const numDimensions = ordered.length;

    const availableWidth = containerWidth - margin.left - margin.right;
    dimensionSpacing = Math.max(100, availableWidth / Math.max(1, numDimensions - 1));
    const width = margin.left + (numDimensions - 1) * dimensionSpacing + margin.right;

    const plotHeight = height - margin.top - margin.bottom;

    const svg = d3.select(args.root).append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

    const scales: Record<string, { x: number; scale: d3.ScaleLinear<number, number> }> = {};
    ordered.forEach((dim, i) => {
      const x = i * dimensionSpacing;
      const [lo, hi] = extents[dim] ?? [0, 0];
      scales[dim] = { x, scale: d3.scaleLinear().domain([lo, hi]).range([plotHeight, 0]) };
    });

    const line = d3
      .line<number>()
      .x((_v, i) => scales[ordered[i]!]!.x)
      .y((v, i) => scales[ordered[i]!]!.scale(v));

    const updateHoverStrokeWidths = (): void => {
      g.selectAll<SVGPathElement, CarDatum>('.line.selected').style('stroke-width', (d) => {
        if (!selectedIds.has(d.id)) return 1;
        return d.id === hoveredId ? lineStrokeWidthHovered : lineStrokeWidth;
      });
    };

    g.selectAll<SVGPathElement, CarDatum>('.line')
      .data(args.data)
      .enter()
      .append('path')
      .attr('class', (d) => (selectedIds.has(d.id) ? 'line selected' : 'line'))
      .attr('d', (d) => line(ordered.map((dim) => toNumber(d[dim]))))
      .style('opacity', (d) => (selectedIds.has(d.id) ? 0.9 : 0))
      .style('stroke', lineStroke)
      .style('stroke-width', (d) => {
        if (!selectedIds.has(d.id)) return 1;
        return d.id === hoveredId ? lineStrokeWidthHovered : lineStrokeWidth;
      })
      .style('pointer-events', (d) => (selectedIds.has(d.id) ? 'all' : 'none'))
      .on('mouseover', (event, d) => {
        if (!selectedIds.has(d.id)) return;
        hoveredId = d.id;
        showTooltip(event, d);
        updateHoverStrokeWidths();
        emit('human', 'hover line');
      })
      .on('mousemove', (event, d) => {
        if (!selectedIds.has(d.id)) return;
        moveTooltip(event);
        void d;
      })
      .on('mouseout', () => {
        hoveredId = null;
        hideTooltip();
        updateHoverStrokeWidths();
        emit('human', 'clear hover');
      });

    const axisGroups = g
      .selectAll<SVGGElement, string>('.axis-group')
      .data(ordered)
      .enter()
      .append('g')
      .attr('class', 'axis-group')
      .attr('transform', (_dim, i) => `translate(${i * dimensionSpacing}, 0)`)
      .attr('data-dimension', (d) => d);

    axisGroups
      .append('g')
      .attr('class', 'axis')
      .each(function (dim) {
        d3.select(this).call(d3.axisLeft(scales[dim]!.scale).ticks(5));
      });

    let draggedDimension: string | null = null;
    let dragStartIndex = 0;
    let dragStartX = 0;
    let dragStartBaseX = 0;
    let draggedAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    let gElement: SVGGElement | null = null;

    const dragStarted = (event: d3.D3DragEvent<SVGTextElement, string, string>, dim: string) => {
      const src = event.sourceEvent as MouseEvent | undefined;
      const target = src?.target instanceof Element ? src.target : null;
      if (target?.closest('.brush')) return;

      draggedDimension = dim;
      const axisEl = target?.closest('.axis-group');
      if (!(axisEl instanceof SVGGElement)) return;
      const axisGroup = d3.select(axisEl);
      draggedAxisGroup = axisGroup;
      gElement = g.node();
      if (!gElement) return;

      const currentOrder = getOrderedDimensions();
      dragStartIndex = currentOrder.indexOf(dim);
      dragStartBaseX = dragStartIndex * dimensionSpacing;

      const pointer = gElement ? d3.pointer(event, gElement) : [0, 0];
      dragStartX = pointer[0];

      axisGroup.raise().style('opacity', 0.7).style('cursor', 'grabbing');
    };

    const dragged = (event: d3.D3DragEvent<SVGTextElement, string, string>, dim: string) => {
      if (!draggedDimension || !draggedAxisGroup || !gElement) return;

      const pointer = d3.pointer(event, gElement);
      const currentX = pointer[0];
      const deltaX = currentX - dragStartX;
      const newX = dragStartBaseX + deltaX;
      draggedAxisGroup.attr('transform', `translate(${newX}, 0)`);

      const newIndex = Math.round(newX / dimensionSpacing);
      const currentOrder = getOrderedDimensions();
      const targetIndex = clampNumber(newIndex, 0, currentOrder.length - 1);

      if (targetIndex === dragStartIndex) return;

      const newOrder = [...currentOrder];
      const oldIndex = newOrder.indexOf(dim);
      newOrder.splice(oldIndex, 1);
      newOrder.splice(targetIndex, 0, dim);
      dimensionOrder.splice(0, dimensionOrder.length, ...newOrder);

      dragStartBaseX = targetIndex * dimensionSpacing;
      dragStartIndex = targetIndex;

      d3.select(gElement)
        .selectAll<SVGGElement, string>('.axis-group')
        .each(function (d) {
          if (d === dim) return;
          const idx = newOrder.indexOf(d);
          d3.select(this).attr('transform', `translate(${idx * dimensionSpacing}, 0)`);
        });

      const newDeltaX = currentX - targetIndex * dimensionSpacing;
      dragStartX = currentX - newDeltaX;
      draggedAxisGroup.attr('transform', `translate(${dragStartBaseX + newDeltaX}, 0)`);
    };

    const dragEnded = (_event: d3.D3DragEvent<SVGTextElement, string, string>, dim: string) => {
      if (!draggedDimension || !draggedAxisGroup) return;
      const currentOrder = getOrderedDimensions();
      const finalIndex = currentOrder.indexOf(dim);
      draggedAxisGroup.attr('transform', `translate(${finalIndex * dimensionSpacing}, 0)`);
      draggedAxisGroup = null;
      draggedDimension = null;
      gElement = null;

      computeSelection();
      render();
      emit('human', 'reorder dimensions');
    };

    axisGroups
      .append('text')
      .attr('class', 'dimension-label')
      .attr('x', 0)
      .attr('y', plotHeight + 25)
      .attr('text-anchor', 'middle')
      .text((d) => d)
      .call(d3.drag<SVGTextElement, string>().on('start', dragStarted).on('drag', dragged).on('end', dragEnded));

    const applyBrushSelectionStyle = (
      brushGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
      opts: { show: boolean },
    ): void => {
      const selectionOpacity = opts.show ? 0.2 : 0;
      const strokeOpacity = opts.show ? 1 : 0;
      brushGroup
        .selectAll<SVGRectElement, unknown>('.selection')
        .attr('stroke', 'black')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4')
        .attr('stroke-opacity', strokeOpacity)
        .attr('fill', 'black')
        .attr('fill-opacity', selectionOpacity);
      brushGroup.selectAll<SVGRectElement, unknown>('.handle').attr('opacity', opts.show ? 1 : 0);
    };

    axisGroups.each(function (dim) {
      const axisGroup = d3.select(this);
      const scale = scales[dim]!.scale;
      const [lo, hi] = extents[dim] ?? [0, 0];
      const range = brushRanges[dim] ?? [lo, hi];

      const brushGroup = axisGroup.append('g').attr('class', 'brush');

      const brush = d3
        .brushY()
        .extent([
          [-20, 0],
          [20, plotHeight],
        ])
        .on('brush', (event) => {
          const hasSelection = Boolean(event.selection);
          applyBrushSelectionStyle(brushGroup, { show: hasSelection });

          if (!event.selection) return;
          if (!(event.sourceEvent instanceof Event)) return;

          const y0 = scale.invert(event.selection[0] as number);
          const y1 = scale.invert(event.selection[1] as number);

          brushRanges[dim] = clampRange([y1, y0], lo, hi);
          computeSelection();

          if (hoveredId !== null && !selectedIds.has(hoveredId)) {
            hoveredId = null;
            hideTooltip();
          }

          d3.select(args.root)
            .selectAll<SVGPathElement, CarDatum>('.line')
            .attr('class', (d) => (selectedIds.has(d.id) ? 'line selected' : 'line'))
            .style('opacity', (d) => (selectedIds.has(d.id) ? 0.9 : 0))
            .style('stroke', lineStroke)
            .style('stroke-width', (d) => {
              if (!selectedIds.has(d.id)) return 1;
              return d.id === hoveredId ? lineStrokeWidthHovered : lineStrokeWidth;
            })
            .style('pointer-events', (d) => (selectedIds.has(d.id) ? 'all' : 'none'));

          emit('human', 'brush selection');
        })
        .on('end', (event) => {
          const hasSelection = Boolean(event.selection);
          applyBrushSelectionStyle(brushGroup, { show: hasSelection });
          if (event.selection) return;
          brushRanges[dim] = [lo, hi];
          computeSelection();
          emit('human', 'clear brush');
          render();
        });

      brushGroup.call(brush);

      const isFiltering = range[0] !== lo || range[1] !== hi;
      if (isFiltering) brushGroup.call(brush.move as any, [scale(range[1]), scale(range[0])]);
      applyBrushSelectionStyle(brushGroup, { show: isFiltering });
    });
  };

  const setBrushRanges = (ranges: Partial<Record<string, BrushRange | null>>, source: ParallelCoordsSource): void => {
    for (const dim of args.dimensions) {
      const next = ranges[dim];
      const [lo, hi] = extents[dim] ?? [0, 0];
      if (next === null) {
        brushRanges[dim] = [lo, hi];
        continue;
      }
      if (!next) continue;
      brushRanges[dim] = clampRange(next, lo, hi);
    }
    computeSelection();
    if (hoveredId !== null && !selectedIds.has(hoveredId)) hideTooltip();
    render();
    emit(source, 'set brush ranges');
  };

  const resetBrushes = (source: ParallelCoordsSource): void => {
    for (const dim of args.dimensions) {
      brushRanges[dim] = extents[dim]!;
    }
    computeSelection();
    if (hoveredId !== null && !selectedIds.has(hoveredId)) hideTooltip();
    render();
    emit(source, 'reset brushes');
  };

  const setDimensionOrder = (order: string[], source: ParallelCoordsSource): void => {
    if (order.length !== args.dimensions.length) {
      throw new Error('dimension order must include every dimension exactly once');
    }
    const seen = new Set<string>();
    order.forEach((d) => seen.add(d));
    if (seen.size !== args.dimensions.length)
      throw new Error('dimension order must include every dimension exactly once');
    for (const d of args.dimensions) {
      if (!seen.has(d)) throw new Error('dimension order must include every dimension exactly once');
    }
    dimensionOrder.splice(0, dimensionOrder.length, ...order);
    render();
    emit(source, 'set dimension order');
  };

  const resetDimensionOrder = (source: ParallelCoordsSource): void => {
    dimensionOrder.splice(0, dimensionOrder.length);
    render();
    emit(source, 'reset dimension order');
  };

  const setHoveredId = (id: number | null, source: ParallelCoordsSource): void => {
    if (id === hoveredId) return;
    hoveredId = id;

    if (hoveredId === null) {
      hideTooltip();
      render();
      emit(source, 'clear hover');
      return;
    }

    const d = args.data.find((x) => x.id === hoveredId) ?? null;
    if (!d || !selectedIds.has(d.id)) {
      hoveredId = null;
      hideTooltip();
      render();
      emit(source, 'clear hover');
      return;
    }

    const rect = args.root.getBoundingClientRect();
    const pageX = rect.left + window.scrollX + rect.width * 0.5;
    const pageY = rect.top + window.scrollY + rect.height * 0.25;
    showTooltipAt(pageX, pageY, d);
    render();
    emit(source, 'set hover');
  };

  const destroy = (): void => {
    hideTooltip();
    d3.select(args.root).selectAll('*').remove();
  };

  computeSelection();
  render();
  emit('system', 'init');

  return {
    render,
    destroy,
    getState,
    getSelectedIds: () => Array.from(selectedIds),
    setBrushRanges,
    resetBrushes,
    setDimensionOrder,
    resetDimensionOrder,
    setHoveredId,
  };
}
