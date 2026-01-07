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
  const { svg, plotId, appId, viewId, graph } = args;
  const plotRef = makePlotRef({ appId, viewId, plotId, suffix: '' });
  applyVacpAttributes(svg, {
    ref: plotRef,
    layer: 'VisualizationLayer',
    kind: 'Visualization',
    title: plotId,
    description: 'Mosaic/vgplot plot (dashboard)',
    data: { plotId },
  });
  applyVacpInteractionAttributes(svg, {
    targetRef: plotRef,
    layer: 'VisualizationLayer',
    description: 'Programmatic interactions for this Mosaic/vgplot visualization.',
    actions: graph.actions,
  });
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
