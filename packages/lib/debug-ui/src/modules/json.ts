import { renderJsonPane } from '../panes/json';
import type { VacpDebugModule } from '../types';

export function createJsonModule(): VacpDebugModule {
  const state = { text: '{}' };

  return {
    id: 'json',
    title: 'JSON',
    icon: 'FileJson',
    render: (container, ctx) => {
      renderJsonPane(container, ctx.runtime, ctx.bridge, state, (next) => {
        Object.assign(state, next);
        ctx.requestRender();
      });
    },
  };
}
