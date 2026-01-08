import type { VacpGraph } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';

import { makePlotRef } from './refs';
import type { CollectedInput } from './inputs';

export function annotateInput(args: { input: CollectedInput; graph: VacpGraph }) {
  const { input, graph } = args;
  applyVacpAttributes(input.element, {
    ref: input.ref,
    layer: 'ConfigLayer',
    kind: 'Widget',
    title: input.meta.label ?? `input ${input.inputId}`,
    description: `Mosaic input widget (${input.meta.kind})`,
    data: { inputId: input.inputId, ...input.meta },
  });
  applyVacpInteractionAttributes(input.element, {
    targetRef: input.ref,
    layer: 'ConfigLayer',
    description: 'Programmatic interactions for this Mosaic input widget.',
    actions: graph.actions,
  });
}

export function annotatePlotSvg(args: {
  svg: SVGElement;
  plotId: string;
  appId: string;
  viewId: string;
  graph: VacpGraph;
}) {
  annotatePlotSurface({ element: args.svg, svg: args.svg, plotId: args.plotId, appId: args.appId, viewId: args.viewId, graph: args.graph });
}

export function annotatePlotSurface(args: {
  element: Element;
  svg?: SVGElement;
  plotId: string;
  appId: string;
  viewId: string;
  graph: VacpGraph;
}) {
  const { element, svg, plotId, appId, viewId, graph } = args;
  const plotRef = makePlotRef({ appId, viewId, plotId, suffix: '' });
  applyVacpAttributes(element, {
    ref: plotRef,
    layer: 'VisualizationLayer',
    kind: 'Visualization',
    title: plotId,
    description: 'Mosaic output surface (plot/table/etc.)',
    data: { plotId },
  });
  applyVacpInteractionAttributes(element, {
    targetRef: plotRef,
    layer: 'VisualizationLayer',
    description: 'Programmatic interactions for this Mosaic view surface.',
    actions: graph.actions,
  });

  if (svg) {
    svg.querySelectorAll('[data-index]').forEach((el) => {
      const idx = el.getAttribute('data-index') ?? 'unknown';
      const markRef = makePlotRef({ appId, viewId, plotId, suffix: `/mark/${idx}` });
      applyVacpAttributes(el, {
        ref: markRef,
        layer: 'VisualizationLayer',
        kind: 'Mark',
        title: `mark ${idx}`,
        description: 'vgplot mark output group',
        data: { plotId, index: idx },
      });
    });
    embedVacpGraphInSvg(svg, graph);
  }
}
