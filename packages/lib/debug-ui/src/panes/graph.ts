import type { VacpRuntimeSnapshot } from '@vacp/core';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';

export function mermaidSourceFromRuntime(
  runtime: VacpRuntimeSnapshot,
  options: { direction: 'LR' | 'TB'; includeActions: boolean; includeStatePreview: boolean },
): string {
  return renderVacpDiagramMermaid({
    capabilities: runtime.currentCapabilities,
    state: runtime.currentState,
    options: {
      direction: options.direction,
      includeActions: options.includeActions,
      includeStatePreview: options.includeStatePreview,
    },
  });
}
