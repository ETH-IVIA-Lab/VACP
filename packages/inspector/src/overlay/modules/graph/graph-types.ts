import type { VacpEdgeKind, VacpLayer, VacpNodeKind, VacpRef } from '@vacp/protocol';
import type { Edge, Node } from '@xyflow/react';

export type GraphDirection = 'LR' | 'TB';

export type SelectedGraphItem = { kind: 'node'; ref: VacpRef } | { kind: 'action'; index: number; name: string } | null;

type VacpGraphNodeData = Record<string, unknown> & {
  item: Exclude<SelectedGraphItem, null>;
  graphKind: 'node' | 'action';
  title: string;
  subtitle: string;
  meta: string;
  description: string | null;
  nodeKind: VacpNodeKind | 'Action';
  layer: VacpLayer | 'ActionLayer';
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  collapsedCount: number;
  onToggleCollapse: ((ref: VacpRef) => void) | null;
  onSelect: (item: Exclude<SelectedGraphItem, null>) => void;
};

export type VacpFlowNode = Node<VacpGraphNodeData, 'vacpGraphNode'>;

export type VacpFlowEdge = Edge<
  {
    kind: VacpEdgeKind | 'targets';
  },
  'smoothstep'
>;

export type VacpGraphCounts = {
  visibleNodes: number;
  hiddenNodes: number;
  visibleEdges: number;
};
