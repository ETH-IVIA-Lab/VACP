import type { VacpDiagramRenderOptions } from '@vacp/diagrams';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';

import { renderMermaidToHost } from '../mermaid';
import type { VacpDebugModule } from '../types';

type GraphModuleState = Required<
  Pick<VacpDiagramRenderOptions, 'direction' | 'includeActions' | 'includeStatePreview'>
>;

export function createGraphModule(initial: GraphModuleState): VacpDebugModule {
  const state: GraphModuleState = { ...initial };
  let lastMermaid = '';

  const makeMermaid = (runtime: import('@vacp/core').VacpRuntimeSnapshot) => {
    lastMermaid = renderVacpDiagramMermaid({
      capabilities: runtime.currentCapabilities,
      state: runtime.currentState,
      options: state,
    });
    return lastMermaid;
  };

  const copyText = (text: string) => {
    const t = text ?? '';
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(t).catch(() => {});
      return;
    }
    const el = document.createElement('textarea');
    el.value = t;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.append(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore
    } finally {
      el.remove();
    }
  };

  return {
    id: 'graph',
    title: 'Graph',
    icon: '🗺️',
    render: async (container, ctx) => {
      container.textContent = '';

      const help = document.createElement('div');
      help.className = 'vacp-debug-ui-small';
      help.textContent =
        'This is the semantic VACP graph for the current view. It updates on human interaction and on agent-style actions.';

      const optsTitle = document.createElement('div');
      optsTitle.className = 'vacp-debug-ui-section-title';
      optsTitle.textContent = 'Diagram';

      const row = document.createElement('div');
      row.className = 'vacp-debug-ui-actions';

      const dirBtn = document.createElement('button');
      dirBtn.type = 'button';
      dirBtn.textContent = state.direction === 'LR' ? 'Direction: LR' : 'Direction: TB';
      dirBtn.title = 'Toggle diagram direction (left-to-right vs top-to-bottom)';

      const actionsBtn = document.createElement('button');
      actionsBtn.type = 'button';
      actionsBtn.textContent = state.includeActions ? 'Actions: on' : 'Actions: off';
      actionsBtn.title = 'Show semantic actions as nodes in the diagram.';
      actionsBtn.setAttribute('aria-pressed', state.includeActions ? 'true' : 'false');

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.textContent = state.includeStatePreview ? 'State preview: on' : 'State preview: off';
      previewBtn.title = 'Show compact current-state previews on nodes (useful while debugging).';
      previewBtn.setAttribute('aria-pressed', state.includeStatePreview ? 'true' : 'false');

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy Mermaid';
      copyBtn.title = 'Copy the Mermaid source for this diagram (useful for sharing in issues/notes).';

      const rerender = async () => {
        dirBtn.textContent = state.direction === 'LR' ? 'Direction: LR' : 'Direction: TB';
        actionsBtn.textContent = state.includeActions ? 'Actions: on' : 'Actions: off';
        actionsBtn.setAttribute('aria-pressed', state.includeActions ? 'true' : 'false');
        previewBtn.textContent = state.includeStatePreview ? 'State preview: on' : 'State preview: off';
        previewBtn.setAttribute('aria-pressed', state.includeStatePreview ? 'true' : 'false');

        const mermaid = makeMermaid(ctx.runtime);
        status.textContent = 'Rendering…';
        await renderMermaidToHost(host, mermaid);
        status.textContent = '';
      };

      dirBtn.addEventListener('click', () => {
        state.direction = state.direction === 'LR' ? 'TB' : 'LR';
        void rerender();
      });
      actionsBtn.addEventListener('click', () => {
        state.includeActions = !state.includeActions;
        void rerender();
      });
      previewBtn.addEventListener('click', () => {
        state.includeStatePreview = !state.includeStatePreview;
        void rerender();
      });
      copyBtn.addEventListener('click', () => copyText(lastMermaid || makeMermaid(ctx.runtime)));

      row.append(dirBtn, actionsBtn, previewBtn, copyBtn);

      const status = document.createElement('div');
      status.className = 'vacp-debug-ui-small';
      status.textContent = '';

      const host = document.createElement('div');
      host.className = 'vacp-debug-ui-diagram';

      container.append(help, optsTitle, row, status, host);
      await rerender();
    },
  };
}
