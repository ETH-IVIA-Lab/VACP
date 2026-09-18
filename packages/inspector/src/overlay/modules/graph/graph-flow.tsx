import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';

import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react';

import { useElementSize } from '@vacp/inspector/overlay/hooks/use-element-size';

import type { SelectedGraphItem, VacpFlowEdge, VacpFlowNode, VacpGraphCounts } from './graph-types';
import { VacpGraphNode } from './graph-node';

const nodeTypes = {
  vacpGraphNode: VacpGraphNode,
} satisfies NodeTypes;

const MIN_GRAPH_ZOOM = 0.04;

function FlowCanvas(props: {
  nodes: VacpFlowNode[];
  edges: VacpFlowEdge[];
  counts: VacpGraphCounts;
  viewportSize: { width: number; height: number };
  onSelect: (item: SelectedGraphItem) => void;
}): ReactElement {
  const { fitView, zoomIn, zoomOut } = useReactFlow<VacpFlowNode, VacpFlowEdge>();

  const fitKey = useMemo(
    () => props.nodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|'),
    [props.nodes],
  );

  useEffect(() => {
    if (props.nodes.length === 0) return;

    if (props.viewportSize.width === 0 || props.viewportSize.height === 0) return;

    const id = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.18, duration: 180, includeHiddenNodes: false });
    });

    return () => window.cancelAnimationFrame(id);
  }, [fitKey, fitView, props.nodes.length, props.viewportSize.height, props.viewportSize.width]);

  const fitGraph = (): void => {
    void fitView({ padding: 0.18, duration: 160, includeHiddenNodes: false });
  };

  return (
    <ReactFlow<VacpFlowNode, VacpFlowEdge>
      nodes={props.nodes}
      edges={props.edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18, includeHiddenNodes: false }}
      minZoom={MIN_GRAPH_ZOOM}
      maxZoom={1.85}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      selectNodesOnDrag={false}
      panOnDrag
      panOnScroll
      zoomOnScroll
      zoomOnPinch
      onNodeClick={(_, node) => props.onSelect(node.data.item)}
      onPaneClick={() => props.onSelect(null)}
      disableKeyboardA11y
      proOptions={{ hideAttribution: true }}
      data-vacp-graph-flow="1"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} />
      <MiniMap<VacpFlowNode>
        pannable
        zoomable
        nodeStrokeWidth={2}
        nodeColor={(node) =>
          node.data.graphKind === 'action' ? 'rgba(245, 158, 11, 0.34)' : 'rgba(148, 163, 184, 0.42)'
        }
        nodeStrokeColor={(node) =>
          node.data.selected
            ? 'rgba(226, 232, 240, 0.82)'
            : node.data.graphKind === 'action'
              ? 'rgba(245, 158, 11, 0.48)'
              : 'rgba(148, 163, 184, 0.52)'
        }
      />
      <Panel position="bottom-left" className="vacp-inspector-flow-controls" aria-label="Graph zoom controls">
        <button
          type="button"
          className="vacp-inspector-flow-control"
          aria-label="Zoom In"
          title="Zoom In"
          onClick={() => {
            void zoomIn({ duration: 140 });
          }}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vacp-inspector-flow-control"
          aria-label="Zoom Out"
          title="Zoom Out"
          onClick={() => {
            void zoomOut({ duration: 140 });
          }}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vacp-inspector-flow-control"
          aria-label="Fit View"
          title="Fit View"
          onClick={fitGraph}
        >
          <Maximize2 aria-hidden="true" />
        </button>
      </Panel>
      <Panel position="top-left" className="vacp-inspector-flow-panel">
        <span>{props.counts.visibleNodes} nodes</span>
        <span>{props.counts.visibleEdges} edges</span>
        {props.counts.hiddenNodes > 0 ? <span>{props.counts.hiddenNodes} hidden</span> : null}
      </Panel>
    </ReactFlow>
  );
}

export function VacpGraphFlow(props: {
  nodes: VacpFlowNode[];
  edges: VacpFlowEdge[];
  counts: VacpGraphCounts;
  onSelect: (item: SelectedGraphItem) => void;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportSize = useElementSize(viewportRef);

  return (
    <ReactFlowProvider>
      <div ref={viewportRef} className="h-full min-h-0 w-full">
        <FlowCanvas {...props} viewportSize={viewportSize} />
      </div>
    </ReactFlowProvider>
  );
}
