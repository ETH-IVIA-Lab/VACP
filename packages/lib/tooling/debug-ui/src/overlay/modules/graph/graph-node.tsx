import {
  AppWindow,
  Braces,
  ChartLine,
  ChartNetwork,
  ChartScatter,
  ChevronDown,
  ChevronRight,
  Database,
  MousePointerClick,
  Network,
  PanelTop,
  SlidersHorizontal,
  View,
  Waypoints,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

import type { VacpFlowNode } from './graph-types';

const nodeKindIcons = {
  Action: Zap,
  App: AppWindow,
  View,
  Visualization: ChartScatter,
  Mark: ChartNetwork,
  EncodingChannel: Waypoints,
  EncodedField: Braces,
  Legend: PanelTop,
  Axis: ChartLine,
  Selection: MousePointerClick,
  Param: SlidersHorizontal,
  Widget: SlidersHorizontal,
  DataHandle: Database,
  InteractionTarget: Network,
} satisfies Record<VacpFlowNode['data']['nodeKind'], LucideIcon>;

function NodeKindIcon(props: { data: VacpFlowNode['data'] }): ReactElement {
  const Icon = nodeKindIcons[props.data.nodeKind];
  return <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />;
}

const HANDLE_POSITIONS = [
  ['left', Position.Left],
  ['right', Position.Right],
  ['top', Position.Top],
  ['bottom', Position.Bottom],
] as const;

export function VacpGraphNode(props: NodeProps<VacpFlowNode>): ReactElement {
  const { data } = props;

  return (
    <div
      className={cn(
        'vacp-debug-ui-flow-node relative flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-md border px-3 py-2.5 text-left shadow-[0_8px_28px_rgba(0,0,0,0.18)]',
        data.graphKind === 'action'
          ? 'vacp-debug-ui-flow-node-action border-amber-200/18 bg-amber-200/[0.045]'
          : 'vacp-debug-ui-flow-node-state border-white/[0.09] bg-[#111b21]/94',
        data.selected && 'vacp-debug-ui-flow-node-selected',
      )}
      title={data.description ? `${data.title}\n${data.description}` : data.title}
      data-vacp-flow-node-kind={data.graphKind}
      data-vacp-graph-node-kind={data.graphKind === 'node' ? data.nodeKind : undefined}
      data-vacp-graph-node-ref={data.item.kind === 'node' ? data.item.ref : undefined}
      data-vacp-graph-node-collapsed={data.collapsed ? 'true' : undefined}
      data-vacp-graph-action-name={data.item.kind === 'action' ? data.item.name : undefined}
    >
      {HANDLE_POSITIONS.map(([name, position]) => (
        <Handle
          key={`target-${name}`}
          id={`target-${name}`}
          type="target"
          position={position}
          className="vacp-debug-ui-flow-handle"
        />
      ))}
      {HANDLE_POSITIONS.map(([name, position]) => (
        <Handle
          key={`source-${name}`}
          id={`source-${name}`}
          type="source"
          position={position}
          className="vacp-debug-ui-flow-handle"
        />
      ))}

      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[11px] font-semibold',
            data.graphKind === 'action'
              ? 'border-amber-100/16 bg-amber-100/[0.07] text-amber-50/84'
              : 'border-white/[0.08] bg-white/[0.035] text-slate-100/74',
          )}
          aria-hidden="true"
        >
          <NodeKindIcon data={data} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="break-words text-[12px] font-semibold leading-4 text-slate-50/90 [overflow-wrap:anywhere]">{data.title}</div>
          {data.subtitle ? (
            <div className="mt-0.5 break-words text-[10.5px] leading-3 text-slate-100/46 [overflow-wrap:anywhere]">{data.subtitle}</div>
          ) : null}
        </div>
        {data.hasChildren && data.onToggleCollapse ? (
          <button
            type="button"
            className="nodrag nopan grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.035] text-slate-100/68 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-slate-100"
            aria-label={data.collapsed ? `Expand ${data.title} one level` : `Collapse ${data.title}`}
            onClick={(event) => {
              event.stopPropagation();
              if (data.item.kind === 'node') data.onToggleCollapse?.(data.item.ref);
            }}
          >
            {data.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>

      <div className="break-words text-[10.5px] font-medium leading-3 text-slate-100/58 [overflow-wrap:anywhere]">{data.meta}</div>
      {data.collapsed && data.collapsedCount > 0 ? (
        <div className="mt-auto text-[10px] font-medium leading-3 text-emerald-100/68">
          {data.collapsedCount} hidden child{data.collapsedCount === 1 ? '' : 'ren'}
        </div>
      ) : null}
    </div>
  );
}
