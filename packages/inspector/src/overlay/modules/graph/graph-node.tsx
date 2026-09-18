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
import type { KeyboardEvent, ReactElement } from 'react';

import { Handle, Position, type NodeProps } from '@xyflow/react';

import { cn } from '@vacp/inspector/ui/lib/utils';

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
} satisfies Partial<Record<VacpFlowNode['data']['nodeKind'], LucideIcon>>;

function NodeKindIcon(props: { data: VacpFlowNode['data'] }): ReactElement {
  const Icon: LucideIcon = nodeKindIcons[props.data.nodeKind as keyof typeof nodeKindIcons] ?? Network;

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

  const selectNode = (): void => {
    data.onSelect(data.item);
  };

  const toggleCollapse = (): void => {
    if (data.item.kind === 'node') data.onToggleCollapse?.(data.item.ref);
  };

  const selectNodeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    const target = event.target instanceof HTMLElement ? event.target : null;

    if (target?.closest('button,a,input,select,textarea,[contenteditable="true"]')) return;
    event.preventDefault();
    selectNode();
  };

  return (
    <div
      className={cn(
        'vacp-inspector-flow-node relative flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-md border px-3 py-2.5 text-left ',
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/32',
        data.graphKind === 'action'
          ? 'vacp-inspector-flow-node-action border-amber-200/18 bg-amber-200/[0.045]'
          : 'vacp-inspector-flow-node-state border-white/[0.09] bg-[#111b21]/94',
        data.selected && 'vacp-inspector-flow-node-selected',
      )}
      title={data.description ? `${data.title}\n${data.description}` : data.title}
      role="group"
      tabIndex={0}
      aria-label={`${data.graphKind === 'action' ? 'Action' : data.nodeKind} ${data.title}`}
      data-vacp-flow-node-kind={data.graphKind}
      data-vacp-graph-selected={data.selected ? 'true' : 'false'}
      data-vacp-graph-node-kind={data.graphKind === 'node' ? data.nodeKind : undefined}
      data-vacp-graph-node-ref={data.item.kind === 'node' ? data.item.ref : undefined}
      data-vacp-graph-node-collapsed={data.collapsed ? 'true' : undefined}
      data-vacp-graph-action-name={data.item.kind === 'action' ? data.item.name : undefined}
      onClick={selectNode}
      onFocus={(event) => {
        if (event.currentTarget === event.target) selectNode();
      }}
      onKeyDown={selectNodeFromKeyboard}
    >
      {HANDLE_POSITIONS.map(([name, position]) => (
        <Handle
          key={`target-${name}`}
          id={`target-${name}`}
          type="target"
          position={position}
          className="vacp-inspector-flow-handle"
          aria-hidden="true"
          tabIndex={-1}
        />
      ))}
      {HANDLE_POSITIONS.map(([name, position]) => (
        <Handle
          key={`source-${name}`}
          id={`source-${name}`}
          type="source"
          position={position}
          className="vacp-inspector-flow-handle"
          aria-hidden="true"
          tabIndex={-1}
        />
      ))}

      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[11px] font-semibold',
            data.graphKind === 'action'
              ? 'border-amber-100/16 bg-amber-100/[0.07] text-amber-50/84'
              : 'border-white/[0.08] bg-white/[0.035] text-neutral-100/74',
          )}
          aria-hidden="true"
        >
          <NodeKindIcon data={data} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="break-words text-[12px] font-semibold leading-4 text-neutral-50/90 [overflow-wrap:anywhere]">
            {data.title}
          </div>
          {data.subtitle ? (
            <div className="mt-0.5 break-words text-[10.5px] leading-3 text-neutral-100/46 [overflow-wrap:anywhere]">
              {data.subtitle}
            </div>
          ) : null}
        </div>
        {data.hasChildren && data.onToggleCollapse ? (
          <button
            type="button"
            className="nodrag nopan grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.035] text-neutral-100/68 transition-colors  hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-neutral-100"
            aria-label={data.collapsed ? `Expand ${data.title} one level` : `Collapse ${data.title}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapse();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
              event.preventDefault();
              event.stopPropagation();
              toggleCollapse();
            }}
          >
            {data.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>

      <div className="break-words text-[10.5px] font-medium leading-3 text-neutral-100/58 [overflow-wrap:anywhere]">
        {data.meta}
      </div>
      {data.collapsed && data.collapsedCount > 0 ? (
        <div className="mt-auto text-[10px] font-medium leading-3 text-emerald-100/68">
          {data.collapsedCount} hidden child{data.collapsedCount === 1 ? '' : 'ren'}
        </div>
      ) : null}
    </div>
  );
}
