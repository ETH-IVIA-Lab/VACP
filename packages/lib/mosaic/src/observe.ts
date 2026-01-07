import type { VacpGraph } from '@vacp/core';

import { annotateInput, annotatePlotSvg } from './annotations';
import type { CollectedInput } from './inputs';
import type { VgplotPlotLike } from './types';
import { wrapUpdate } from './runtime';

/**
 * Keep the runtime timeline "alive" by observing human-driven updates.
 *
 * Mosaic/vgplot doesn't provide a single high-level event stream for all
 * interactions, so we attach lightweight observers:
 * - input widget selection updates
 * - interactor selection updates
 * - SVG replacement (reactive re-render) to keep annotations present
 */
export function installMosaicInputObservers(args: {
  inputs: CollectedInput[];
  graph: VacpGraph;
  notifyRuntime: (message: string, opts?: { immediate?: boolean }) => void;
}) {
  const { inputs, graph, notifyRuntime } = args;
  for (const input of inputs) {
    annotateInput({ input, graph });
    if (input.input.selection) wrapUpdate(input.input.selection, 'input.selection.update', (m) => notifyRuntime(m));
  }
}

export function installMosaicPlotObservers(args: {
  plots: Array<{ plotId: string; plot: VgplotPlotLike; svg: SVGElement }>;
  graph: VacpGraph;
  appId: string;
  viewId: string;
  notifyRuntime: (message: string, opts?: { immediate?: boolean }) => void;
}) {
  const { plots, graph, appId, viewId, notifyRuntime } = args;

  for (const { plotId, plot, svg } of plots) {
    plot.interactors.forEach((it) => {
      const origInit = it.init;
      it.init = async (svgEl: SVGElement) => {
        const res = origInit ? await origInit.call(it, svgEl) : undefined;
        annotatePlotSvg({ svg: svgEl, plotId, appId, viewId, graph });
        notifyRuntime('interactor.init', { immediate: true });
        if (it.selection) wrapUpdate(it.selection, 'selection.update', (m) => notifyRuntime(m));
        return res;
      };
      if (it.selection) wrapUpdate(it.selection, 'selection.update', (m) => notifyRuntime(m));
    });

    annotatePlotSvg({ svg, plotId, appId, viewId, graph });

    const anyPlot = plot as unknown as { __vacpObserver?: MutationObserver; __vacpSvgObserver?: MutationObserver };
    anyPlot.__vacpObserver?.disconnect();
    anyPlot.__vacpSvgObserver?.disconnect();

    const host = svg.closest('.plot') ?? svg.parentElement ?? plot.element ?? null;
    if (!host) continue;

    const attachSvgObserver = (svgEl: SVGElement) => {
      anyPlot.__vacpSvgObserver?.disconnect();
      let inApply = false;
      const svgObs = new MutationObserver(() => {
        if (inApply) return;
        const needs =
          !svgEl.querySelector('metadata[type="application/vacp+json"]') ||
          !svgEl.getAttribute('data-vacp-ref') ||
          !svgEl.getAttribute('data-interaction-vacp-actions');
        if (!needs) return;
        inApply = true;
        try {
          annotatePlotSvg({ svg: svgEl, plotId, appId, viewId, graph });
        } finally {
          inApply = false;
        }
      });
      svgObs.observe(svgEl, { childList: true, attributes: true });
      anyPlot.__vacpSvgObserver = svgObs;
    };

    let lastSvg = svg;
    attachSvgObserver(lastSvg);

    const obs = new MutationObserver(() => {
      const next = host.querySelector('svg');
      if (!next || next === lastSvg) return;
      lastSvg = next;
      annotatePlotSvg({ svg: next, plotId, appId, viewId, graph });
      attachSvgObserver(next);
    });
    obs.observe(host, { childList: true, subtree: true });
    anyPlot.__vacpObserver = obs;
  }
}
