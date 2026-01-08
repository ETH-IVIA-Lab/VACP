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
}
