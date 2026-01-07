import { renderPlaybookPane } from '../panes/playbook';
import type { VacpDebugModule } from '../types';

export function createPlaybookModule(): VacpDebugModule {
  let selectedId: string | null = null;
  let selectedStepIdx = 0;

  return {
    id: 'playbook',
    title: 'Playbook',
    icon: '🧭',
    render: (container, ctx) => {
      renderPlaybookPane({
        container,
        runtime: ctx.runtime,
        bridge: ctx.bridge,
        playbooks: ctx.playbooks,
        selectedId,
        selectedStepIdx,
        setSelected: (next) => {
          if (next.playbookId !== undefined) selectedId = next.playbookId;
          if (next.stepIdx !== undefined) selectedStepIdx = next.stepIdx;
          ctx.requestRender();
        },
      });
    },
  };
}
