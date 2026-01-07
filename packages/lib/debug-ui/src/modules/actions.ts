import { renderActionsPane } from '../panes/actions';
import type { VacpDebugModule } from '../types';

export function createActionsModule(): VacpDebugModule {
  const state = { selectedAction: undefined as string | undefined, paramsText: '{}' };

  return {
    id: 'actions',
    title: 'Actions',
    icon: '⚡',
    render: (container, ctx) => {
      renderActionsPane(container, ctx.runtime, ctx.bridge, state, (next) => {
        Object.assign(state, next);
        ctx.requestRender();
      });
    },
  };
}
