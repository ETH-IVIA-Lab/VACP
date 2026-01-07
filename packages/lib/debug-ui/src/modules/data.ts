import { createInitialDataUiState, renderDataPane } from '../panes/data';
import type { VacpDebugModule } from '../types';

export function createDataModule(): VacpDebugModule {
  const state = createInitialDataUiState();

  return {
    id: 'data',
    title: 'Data',
    icon: '🦆',
    render: async (container, ctx) => {
      await renderDataPane({
        container,
        runtime: ctx.runtime,
        bridge: ctx.bridge,
        state,
        onChange: (next) => {
          Object.assign(state, next);
          ctx.requestRender();
        },
      });
    },
  };
}
