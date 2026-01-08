import { createInitialDataUiState, renderDataPane } from '../panes/data';
import type { VacpDebugModule } from '../types';

export function createDataModule(): VacpDebugModule {
  const state = createInitialDataUiState();
  const defaultQuery = state.queryText;
  let lastGraphSig: string | null = null;

  const resetQueryState = () => {
    // Preserve UX preferences across view changes.
    const maxRows = state.maxRows;
    const viewMode = state.viewMode;
    Object.assign(state, createInitialDataUiState(), {
      maxRows,
      viewMode,
    });
    state.selectedHandleRef = undefined;
    state.queryText = defaultQuery;
  };

  const graphSignature = (graph: { nodes?: any[]; edges?: any[]; actions?: any[] }): string => {
    const nodes = (graph.nodes ?? []).map((n) => `${String(n.kind)}:${String(n.ref)}`).join('|');
    const edges = (graph.edges ?? []).map((e) => `${String(e.kind)}:${String(e.from)}->${String(e.to)}`).join('|');
    const actions = (graph.actions ?? []).map((a) => `${String(a.name)}:${String(a.targetRef ?? '')}`).join('|');
    return `${nodes}\n${edges}\n${actions}`;
  };

  return {
    id: 'data',
    title: 'Data',
    icon: 'Database',
    render: async (container, ctx) => {
      const sig = graphSignature(ctx.runtime.currentCapabilities.graph as any);
      if (sig !== lastGraphSig) {
        lastGraphSig = sig;
        resetQueryState();
      } else if (state.selectedHandleRef) {
        // If the selected handle disappeared (provider re-mounted), clear it.
        const exists = (ctx.runtime.currentCapabilities.graph.nodes ?? []).some(
          (n) => String((n as any).ref) === String(state.selectedHandleRef),
        );
        if (!exists) resetQueryState();
      }
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
