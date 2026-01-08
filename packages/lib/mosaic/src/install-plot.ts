import { applyVacpAttributes } from '@vacp/dom';

import { makePlotRef } from './refs';
import { installVacpOnVgplotDashboard } from './install-dashboard';
import type { InstallVacpOnVgplotOptions, VgplotPlotLike } from './types';

export function installVacpOnVgplot(plot: VgplotPlotLike, svg: SVGElement, options: InstallVacpOnVgplotOptions): void {
  installVacpOnVgplotDashboard({
    root: svg,
    plots: [{ plotId: options.plotId, plot, element: svg, svg }],
    options: {
      appId: options.appId,
      viewId: options.viewId,
      title: options.title,
      description: options.description,
      globalKey: options.globalKey,
      playbooks: options.playbooks,
    },
  });

  if (options.annotateHostElement && plot.element) {
    applyVacpAttributes(plot.element, {
      ref: makePlotRef({ appId: options.appId, viewId: options.viewId, plotId: options.plotId, suffix: '/host' }),
      layer: 'ViewLayer',
      kind: 'InteractionTarget',
      description: 'Host element containing the vgplot visualization and associated legends.',
      data: { plotId: options.plotId },
    });
  }
}
