import type { VacpRef } from '@vacp/core';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  ClipboardCopy,
  PanelRightClose,
  PanelRightOpen,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { renderVacpDiagramMermaid } from '@vacp/diagrams';

import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from '@vacp/debug-ui/overlay/debug-ui-breakpoints';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { ModuleHeader, ModulePane, ModuleRoot } from './module-layout';
import type { VacpDebugModuleProps } from './module-types';
import { VacpGraphFlow } from './graph/graph-flow';
import {
  buildInspectorValue,
  buildVacpFlowGraph,
  safeJson,
  shortRef,
} from './graph/graph-model';
import { useVacpGraphUiStore } from './graph/graph-state';
import type { SelectedGraphItem } from './graph/graph-types';

function selectedDescription(selected: SelectedGraphItem): string {
  if (!selected) return 'Select a node or action to see its full JSON.';
  if (selected.kind === 'action') return `Action ${selected.name}`;
  return `Node ${shortRef(selected.ref)}`;
}

export function GraphModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactControls = rootSize.width < DEBUG_UI_PANEL_BREAKPOINTS.compactControls;
  const dense = isDenseDebugPanel(rootSize.width, rootSize.height);
  const boundWide = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const iconButtonSize = 'iconSm';
  const includeActionsDefault = useVacpDebugUiStore((s) => s.includeActionsDefault);
  const inspectOpen = useVacpDebugUiStore((s) => s.graphInspectOpen);
  const setInspectOpen = useVacpDebugUiStore((s) => s.setGraphInspectOpen);
  const direction = useVacpGraphUiStore((s) => s.direction);
  const includeActions = useVacpGraphUiStore((s) => s.includeActions);
  const selected = useVacpGraphUiStore((s) => s.selected);
  const collapsedRefs = useVacpGraphUiStore((s) => s.collapsedRefs);
  const syncIncludeActionsDefault = useVacpGraphUiStore((s) => s.syncIncludeActionsDefault);
  const toggleDirection = useVacpGraphUiStore((s) => s.toggleDirection);
  const toggleIncludeActions = useVacpGraphUiStore((s) => s.toggleIncludeActions);
  const selectGraphItem = useVacpGraphUiStore((s) => s.selectGraphItem);
  const pruneSelectedNodeIds = useVacpGraphUiStore((s) => s.pruneSelectedNodeIds);
  const pruneCollapsedRefs = useVacpGraphUiStore((s) => s.pruneCollapsedRefs);
  const toggleCollapsedRef = useVacpGraphUiStore((s) => s.toggleCollapsedRef);
  const effectiveInspectOpen = inspectOpen && !dense;
  const showSideBySide = effectiveInspectOpen && rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const [mermaidCopied, setMermaidCopied] = useState(false);

  const graph = props.runtime.currentCapabilities.graph;

  const toggleCollapse = useCallback((ref: VacpRef) => toggleCollapsedRef(graph, ref), [graph, toggleCollapsedRef]);

  const flow = useMemo(
    () =>
      buildVacpFlowGraph({
        graph,
        direction,
        includeActions,
        collapsedRefs,
        selected,
        onToggleCollapse: toggleCollapse,
      }),
    [collapsedRefs, direction, graph, includeActions, selected, toggleCollapse],
  );

  const mermaidText = useMemo(
    () => renderVacpDiagramMermaid({ capabilities: props.runtime.currentCapabilities, options: { direction, includeActions } }),
    [direction, includeActions, props.runtime.currentCapabilities],
  );

  const inspectorValue = useMemo(() => buildInspectorValue(props.runtime, selected), [props.runtime, selected]);
  const inspectorText = useMemo(() => (selected ? safeJson(inspectorValue) : ''), [inspectorValue, selected]);
  const copyMermaid = useCallback(async () => {
    await copyTextToClipboard(mermaidText);
    setMermaidCopied(true);
  }, [mermaidText]);

  useEffect(() => {
    if (!mermaidCopied) return;
    const id = window.setTimeout(() => setMermaidCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [mermaidCopied]);

  useEffect(() => {
    if (!dense || !inspectOpen) return;
    setInspectOpen(false);
  }, [dense, inspectOpen, setInspectOpen]);

  useEffect(() => {
    syncIncludeActionsDefault(includeActionsDefault);
  }, [includeActionsDefault, syncIncludeActionsDefault]);

  useEffect(() => {
    pruneCollapsedRefs(graph);
  }, [graph, pruneCollapsedRefs]);

  useEffect(() => {
    pruneSelectedNodeIds(new Set(flow.nodes.map((node) => node.id)));
  }, [flow.nodes, pruneSelectedNodeIds]);

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
      )}
      data-vacp-graph="1"
      data-vacp-direction={direction}
      data-vacp-graph-renderer="xyflow"
    >
      <ModulePane className={cn('flex min-h-0 flex-1 flex-col', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="Graph"
          description="Pan, zoom, fit, and select VACP nodes. Mermaid source is available from the copy action."
          compact={compactControls}
          actions={
            <>
              <IconButton
                icon={
                  direction === 'LR' ? (
                    <ArrowLeftRight className="h-4 w-4 text-slate-100/90" />
                  ) : (
                    <ArrowUpDown className="h-4 w-4 text-slate-100/90" />
                  )
                }
                label="Toggle direction"
                title="Toggle graph direction."
                size={iconButtonSize}
                onClick={toggleDirection}
              />
              <IconButton
                icon={<Zap className="h-4 w-4 text-slate-100/90" />}
                label={includeActions ? 'Hide actions' : 'Show actions'}
                title="Show semantic actions as graph nodes."
                pressed={includeActions}
                size={iconButtonSize}
                onClick={toggleIncludeActions}
              />
              <div className="vacp-debug-ui-copy-action">
                <IconButton
                  icon={
                    mermaidCopied ? (
                      <Check className="h-4 w-4 text-emerald-100/90" />
                    ) : (
                      <Workflow className="h-4 w-4 text-slate-100/90" />
                    )
                  }
                  label="Copy Mermaid"
                  title={mermaidCopied ? 'Mermaid source copied.' : 'Copy Mermaid graph source.'}
                  pressed={mermaidCopied}
                  size={iconButtonSize}
                  onClick={() => void copyMermaid()}
                />
                <span
                  className={cn('vacp-debug-ui-copy-feedback', mermaidCopied && 'vacp-debug-ui-copy-feedback-visible')}
                  role="status"
                  aria-live="polite"
                >
                  Copied
                </span>
              </div>
              <IconButton
                icon={
                  inspectOpen ? (
                    <PanelRightClose className="h-4 w-4 text-slate-100/90" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4 text-slate-100/90" />
                  )
                }
                label={inspectOpen ? 'Hide inspect pane' : 'Show inspect pane'}
                title={inspectOpen ? 'Hide the Inspect pane.' : 'Show the Inspect pane.'}
                pressed={effectiveInspectOpen}
                size={iconButtonSize}
                onClick={() => setInspectOpen(!inspectOpen)}
              />
            </>
          }
        />

        <ModulePane tone="surface" className="vacp-debug-ui-flow h-full min-h-0 w-full overflow-hidden">
          <VacpGraphFlow nodes={flow.nodes} edges={flow.edges} counts={flow.counts} onSelect={selectGraphItem} />
        </ModulePane>
      </ModulePane>

      {effectiveInspectOpen ? (
        <ModulePane
          className={cn('flex min-h-0 flex-col', !showSideBySide && 'max-h-[45%]', dense ? 'gap-2' : 'gap-3')}
        >
          <ModuleHeader
            title="Inspect"
            description={selectedDescription(selected)}
            compact={compactControls}
            actions={
              <>
                <IconButton
                  icon={<XCircle className="h-4 w-4 text-slate-100/90" />}
                  label="Clear selection"
                  title="Clear the selected node or action."
                  size={iconButtonSize}
                  onClick={() => selectGraphItem(null)}
                />
                <IconButton
                  icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
                  label="Copy JSON"
                  title="Copy the inspected JSON to clipboard."
                  size={iconButtonSize}
                  onClick={() => void copyTextToClipboard(inspectorText)}
                />
              </>
            }
          />

          <JsonViewer value={selected ? inspectorValue : null} className={cn('flex-1', dense && 'p-2')} />
        </ModulePane>
      ) : null}
    </ModuleRoot>
  );
}
