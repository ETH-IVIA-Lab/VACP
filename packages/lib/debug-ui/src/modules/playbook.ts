import { renderPlaybookPane } from '../panes/playbook';
import type { VacpDebugModule } from '../types';

export function createPlaybookModule(): VacpDebugModule {
  let selectedId: string | null = null;
  let selectedStepIdx = 0;
  let cursorStepIdx = 0;
  let lastResultText = '';
  let lastErrorText = '';

  return {
    id: 'playbook',
    title: 'Playbook',
    icon: 'Route',
    render: (container, ctx) => {
      renderPlaybookPane({
        container,
        runtime: ctx.runtime,
        bridge: ctx.bridge,
        playbooks: ctx.playbooks,
        selectedId,
        selectedStepIdx,
        cursorStepIdx,
        lastResultText,
        lastErrorText,
        setSelected: (next) => {
          if (next.playbookId !== undefined) {
            selectedId = next.playbookId;
            selectedStepIdx = 0;
            cursorStepIdx = 0;
            lastResultText = '';
            lastErrorText = '';
          }
          if (next.stepIdx !== undefined) selectedStepIdx = next.stepIdx;
          if (next.cursorIdx !== undefined) cursorStepIdx = next.cursorIdx;
          ctx.requestRender();
        },
        setOutput: (next) => {
          if (next.lastResultText !== undefined) lastResultText = next.lastResultText;
          if (next.lastErrorText !== undefined) lastErrorText = next.lastErrorText;
        },
      });
    },
  };
}
