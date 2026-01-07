import type { VacpCapabilitiesSnapshot } from '@vacp/core';
import type { VgplotPlotLike } from '@vacp/mosaic';

import { pickInterval1D, pickInterval2D } from './vgplot_helpers';

export type BridgeLike = {
  getCapabilities: () => Promise<VacpCapabilitiesSnapshot>;
  execute: (call: { callId: string; name: string; params?: unknown }) => Promise<{ ok: boolean; result?: unknown }>;
};

async function demoSet(bridge: BridgeLike, plots: Array<{ plotId: string; plot: VgplotPlotLike }>): Promise<void> {
  const i2d = pickInterval2D(plots);
  if (i2d) {
    const [x0, x1] = i2d.x ?? [0, 1];
    const [y0, y1] = i2d.y ?? [0, 1];
    const xa = x0 + 0.25 * (x1 - x0);
    const xb = x0 + 0.75 * (x1 - x0);
    const ya = y0 + 0.25 * (y1 - y0);
    const yb = y0 + 0.75 * (y1 - y0);
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.set_interval_2d',
      params: { plotId: i2d.plotId, interactorId: i2d.interactorId, x0: xa, x1: xb, y0: ya, y1: yb },
    });
    return;
  }

  const i1d = pickInterval1D(plots);
  if (i1d) {
    const [d0, d1] = i1d.domain ?? [0, 1];
    const a = d0 + 0.25 * (d1 - d0);
    const b = d0 + 0.75 * (d1 - d0);
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.set_interval_1d',
      params: { plotId: i1d.plotId, interactorId: i1d.interactorId, min: a, max: b },
    });
    return;
  }

  const caps = await bridge.getCapabilities();
  const widget = caps.graph.nodes.find((n) => n.kind === 'Widget');
  if (widget) {
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.set_input_option_index',
      params: { ref: widget.ref, index: 1 },
    });
    return;
  }

  const toggle = caps.graph.nodes.find((n) => n.kind === 'InteractionTarget' && n.title === 'Toggle');
  if (toggle) {
    const m = toggle.ref.match(/\/([^/]+)\/interactor\/([^/]+)$/);
    if (!m) throw new Error('Could not parse toggle ref');
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.set_toggle',
      params: { plotId: m[1], interactorId: m[2], value: 'rain' },
    });
    return;
  }

  throw new Error('No Interval/Widget/Toggle action target found in this spec');
}

async function demoClear(bridge: BridgeLike, plots: Array<{ plotId: string; plot: VgplotPlotLike }>): Promise<void> {
  const i2d = pickInterval2D(plots);
  if (i2d) {
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.clear_interval_2d',
      params: { plotId: i2d.plotId, interactorId: i2d.interactorId },
    });
    return;
  }

  const i1d = pickInterval1D(plots);
  if (i1d) {
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.clear_interval_1d',
      params: { plotId: i1d.plotId, interactorId: i1d.interactorId },
    });
    return;
  }

  const caps = await bridge.getCapabilities();
  const widget = caps.graph.nodes.find((n) => n.kind === 'Widget');
  if (widget) {
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.clear_input',
      params: { ref: widget.ref },
    });
    return;
  }

  const toggle = caps.graph.nodes.find((n) => n.kind === 'InteractionTarget' && n.title === 'Toggle');
  if (toggle) {
    const m = toggle.ref.match(/\/([^/]+)\/interactor\/([^/]+)$/);
    if (!m) throw new Error('Could not parse toggle ref');
    await bridge.execute({
      callId: crypto.randomUUID(),
      name: 'mosaic.clear_toggle',
      params: { plotId: m[1], interactorId: m[2] },
    });
    return;
  }

  throw new Error('No Interval/Widget/Toggle action target found in this spec');
}

export function wireDemoButtons(args: {
  demoSetButton: HTMLButtonElement;
  demoClearButton: HTMLButtonElement;
  checksDiv: HTMLElement;
  getContext: () => { bridge: BridgeLike | null; plots: Array<{ plotId: string; plot: VgplotPlotLike }> };
  refreshDebug: () => Promise<void>;
}): void {
  const { demoSetButton, demoClearButton, checksDiv, getContext, refreshDebug } = args;

  demoSetButton.addEventListener('click', async () => {
    try {
      const { bridge, plots } = getContext();
      if (!bridge || !plots.length) throw new Error('No plot/bridge available');
      await demoSet(bridge, plots);
      await refreshDebug();
    } catch (err) {
      checksDiv.textContent = `Demo failed: ${String(err)}`;
    }
  });

  demoClearButton.addEventListener('click', async () => {
    try {
      const { bridge, plots } = getContext();
      if (!bridge || !plots.length) throw new Error('No plot/bridge available');
      await demoClear(bridge, plots);
      await refreshDebug();
    } catch (err) {
      checksDiv.textContent = `Clear failed: ${String(err)}`;
    }
  });
}
